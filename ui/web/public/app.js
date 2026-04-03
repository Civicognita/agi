// ===================================================================
// Aionima WebChat — Vanilla ES Module Client
// ===================================================================

// ---- Configuration ----

const WS_URL = `ws://${location.hostname}:${location.port || 8080}`;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

// ---- DOM references ----

const dom = {
  gatewayState:     document.getElementById("gateway-state"),
  connectionStatus: document.getElementById("connection-status"),
  messages:         document.getElementById("messages"),
  detailPanel:      document.getElementById("detail-panel"),
  detailContent:    document.getElementById("detail-content"),
  closeDetail:      document.getElementById("close-detail"),
  replyBar:         document.getElementById("reply-bar"),
  replyContext:     document.getElementById("reply-context"),
  replyInput:       document.getElementById("reply-input"),
  replySend:        document.getElementById("reply-send"),
  replyCancel:      document.getElementById("reply-cancel"),
  reconnectOverlay: document.getElementById("reconnect-overlay"),
};

// ---- Application state ----

const state = {
  /** @type {WebSocket|null} */
  ws: null,
  /** @type {Map<string, object>} */
  messages: new Map(),
  /** @type {string|null} */
  selectedId: null,
  /** @type {string|null} */
  replyToId: null,
  reconnectAttempts: 0,
  /** @type {number|null} */
  reconnectTimer: null,
  /** @type {Array<string>} queued messages during disconnect */
  outQueue: [],
};

// ===================================================================
// 1. WebSocket Connection Handler (Task #101)
// ===================================================================

function connect() {
  setConnectionStatus("connecting");

  const ws = new WebSocket(WS_URL);
  state.ws = ws;

  ws.addEventListener("open", () => {
    state.reconnectAttempts = 0;
    setConnectionStatus("connected");
    hideReconnectOverlay();

    // Flush queued messages
    while (state.outQueue.length > 0) {
      const msg = state.outQueue.shift();
      if (msg) ws.send(msg);
    }
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch {
      console.warn("[webchat] invalid message:", event.data);
    }
  });

  ws.addEventListener("close", () => {
    state.ws = null;
    setConnectionStatus("disconnected");
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    // error event is always followed by close — reconnect handled there
  });
}

function scheduleReconnect() {
  if (state.reconnectTimer !== null) return;

  const delay = Math.min(
    RECONNECT_DELAY_MS * Math.pow(1.5, state.reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  state.reconnectAttempts++;

  showReconnectOverlay();

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

function wsSend(type, payload) {
  const msg = JSON.stringify({ type, payload });
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(msg);
  } else {
    state.outQueue.push(msg);
  }
}

// ---- Connection status UI ----

function setConnectionStatus(status) {
  dom.connectionStatus.textContent = status;
  dom.connectionStatus.className = `conn-status ${status}`;
}

function showReconnectOverlay() {
  dom.reconnectOverlay.classList.remove("hidden");
}

function hideReconnectOverlay() {
  dom.reconnectOverlay.classList.add("hidden");
}

// ===================================================================
// 2. Server message handling
// ===================================================================

function handleServerMessage(msg) {
  switch (msg.type) {
    case "message_received":
      onMessageReceived(msg.payload);
      break;
    case "reply_sent":
      onReplySent(msg.payload);
      break;
    case "error":
      onError(msg.payload);
      break;
    case "state_change":
      onStateChange(msg.payload);
      break;
    default:
      console.log("[webchat] unknown message type:", msg.type);
  }
}

function onMessageReceived(payload) {
  const entry = {
    ...payload,
    status: "pending",
  };
  state.messages.set(payload.queueMessageId, entry);
  renderMessageList();
  scrollToBottom();
}

function onReplySent(payload) {
  const entry = state.messages.get(payload.queueMessageId);
  if (entry) {
    entry.status = "replied";
    entry.replyCoaFingerprint = payload.coaFingerprint;
    entry.repliedAt = payload.sentAt;
  }

  // Close reply bar if replying to this message
  if (state.replyToId === payload.queueMessageId) {
    closeReplyBar();
  }

  renderMessageList();
  updateDetailIfSelected(payload.queueMessageId);
}

function onError(payload) {
  if (payload.relatedMessageId) {
    const entry = state.messages.get(payload.relatedMessageId);
    if (entry) {
      entry.status = "error";
      entry.errorMessage = payload.message;
    }
    renderMessageList();
    updateDetailIfSelected(payload.relatedMessageId);
  }
  console.error("[webchat] error:", payload.message);
}

function onStateChange(payload) {
  setGatewayState(payload.to || payload.state || "UNKNOWN");
}

function setGatewayState(gatewayState) {
  const el = dom.gatewayState;
  el.textContent = gatewayState;
  el.className = `state-badge state-${gatewayState.toLowerCase()}`;
}

// ===================================================================
// 3. Chat UI Rendering (Task #102)
// ===================================================================

function renderMessageList() {
  if (state.messages.size === 0) {
    dom.messages.innerHTML = '<div class="empty-state">No messages yet. Waiting for inbound...</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const [id, msg] of state.messages) {
    const el = document.createElement("div");
    el.className = `msg${state.selectedId === id ? " selected" : ""}`;
    el.dataset.id = id;

    const senderName = msg.displayName || msg.channelUserId;
    const time = formatTime(msg.receivedAt);
    const contentText = formatContent(msg.content);

    el.innerHTML = `
      <div class="msg-header">
        <span>
          <span class="msg-sender">${esc(senderName)}</span>
          <span class="msg-channel">${esc(msg.channelId)}</span>
        </span>
        <span>${esc(time)}</span>
      </div>
      <div class="msg-body${typeof msg.content === "object" && msg.content.type !== "text" ? " media" : ""}">
        ${esc(contentText)}
      </div>
      ${renderStatusBadge(msg)}
    `;

    el.addEventListener("click", () => selectMessage(id));
    fragment.appendChild(el);
  }

  dom.messages.replaceChildren(fragment);
}

function renderStatusBadge(msg) {
  if (msg.status === "replied") {
    return `<div class="msg-status replied">replied</div>`;
  }
  if (msg.status === "error") {
    return `<div class="msg-status error">failed: ${esc(msg.errorMessage || "unknown")}</div>`;
  }
  return "";
}

function formatContent(content) {
  if (!content) return "[empty]";
  if (typeof content === "string") return content;
  if (typeof content === "object") {
    if (content.type === "text") return content.text;
    if (content.type === "voice") return `[voice ${content.duration}s]`;
    if (content.type === "media") return `[${content.mimeType || "file"}]${content.caption ? " " + content.caption : ""}`;
  }
  return JSON.stringify(content);
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function scrollToBottom() {
  const container = document.getElementById("message-list");
  if (container) container.scrollTop = container.scrollHeight;
}

// ---- Message selection & detail panel ----

function selectMessage(id) {
  state.selectedId = id;
  const msg = state.messages.get(id);
  if (!msg) return;

  renderMessageList();
  showDetailPanel(msg);
}

function showDetailPanel(msg) {
  dom.detailPanel.classList.remove("hidden");

  const rows = [
    { label: "Queue ID", value: msg.queueMessageId },
    { label: "Entity ID", value: msg.entityId, cls: "" },
    { label: "COA Fingerprint", value: msg.coaFingerprint, cls: "fingerprint" },
    { label: "Channel", value: msg.channelId },
    { label: "Channel User", value: msg.channelUserId },
    { label: "Display Name", value: msg.displayName || "Unknown" },
    { label: "Received", value: msg.receivedAt },
    { label: "Status", value: msg.status },
  ];

  if (msg.replyCoaFingerprint) {
    rows.push({ label: "Reply COA", value: msg.replyCoaFingerprint, cls: "fingerprint" });
  }
  if (msg.repliedAt) {
    rows.push({ label: "Replied At", value: msg.repliedAt });
  }
  if (msg.errorMessage) {
    rows.push({ label: "Error", value: msg.errorMessage });
  }

  let html = rows.map(r =>
    `<div class="detail-row">
      <div class="detail-label">${esc(r.label)}</div>
      <div class="detail-value${r.cls ? " " + r.cls : ""}">${esc(r.value || "")}</div>
    </div>`
  ).join("");

  // Reply button (only for pending messages)
  if (msg.status === "pending") {
    html += `
      <div class="detail-actions">
        <button onclick="window.__openReply('${esc(msg.queueMessageId)}')">Reply</button>
      </div>
    `;
  }

  dom.detailContent.innerHTML = html;
}

function updateDetailIfSelected(id) {
  if (state.selectedId === id) {
    const msg = state.messages.get(id);
    if (msg) showDetailPanel(msg);
  }
}

// ---- Reply bar ----

window.__openReply = function(queueMessageId) {
  const msg = state.messages.get(queueMessageId);
  if (!msg) return;

  state.replyToId = queueMessageId;
  const senderName = msg.displayName || msg.channelUserId;

  dom.replyContext.textContent = `Replying to ${senderName} via ${msg.channelId}`;
  dom.replyBar.classList.remove("hidden");
  dom.replyInput.value = "";
  dom.replyInput.focus();
};

function closeReplyBar() {
  state.replyToId = null;
  dom.replyBar.classList.add("hidden");
  dom.replyInput.value = "";
}

function sendReply() {
  const text = dom.replyInput.value.trim();
  if (!text || !state.replyToId) return;

  wsSend("reply_request", {
    queueMessageId: state.replyToId,
    content: { type: "text", text },
  });

  dom.replyInput.value = "";
  dom.replySend.disabled = true;
  setTimeout(() => { dom.replySend.disabled = false; }, 500);
}

// ---- Utility ----

function esc(str) {
  if (typeof str !== "string") return "";
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

// ===================================================================
// 4. Event bindings
// ===================================================================

dom.closeDetail.addEventListener("click", () => {
  dom.detailPanel.classList.add("hidden");
  state.selectedId = null;
  renderMessageList();
});

dom.replySend.addEventListener("click", sendReply);
dom.replyCancel.addEventListener("click", closeReplyBar);

dom.replyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendReply();
  }
  if (e.key === "Escape") {
    closeReplyBar();
  }
});

// ===================================================================
// 5. Bootstrap
// ===================================================================

renderMessageList();
connect();
