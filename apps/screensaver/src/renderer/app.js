// @ts-nocheck
const { quit, gatewayUrl, wsUrl } = window.screensaver;

document.body.addEventListener("click", quit);

// === Config ===

const SPEED_MAP = { slow: 0.5, normal: 1.2, fast: 2.5 };
let hudSpeed = SPEED_MAP.normal;
let design = "hud-bar";

async function loadConfig() {
  try {
    const res = await fetch(gatewayUrl + "/api/screensaver/config");
    const cfg = await res.json();
    if (cfg.speed && SPEED_MAP[cfg.speed]) hudSpeed = SPEED_MAP[cfg.speed];
    if (cfg.design) design = cfg.design;
  } catch { /* defaults */ }
}

// === Design Builders ===

const scene = document.getElementById("scene");

function buildHudBar() {
  scene.className = "hud-bar";
  scene.innerHTML = `
    <div id="hud">
      <div class="hud-left">
        <img src="logo.png" alt="Aionima" class="logo">
        <div class="brand">
          <div class="brand-name">Aionima</div>
          <div class="brand-status" id="gateway-status">CONNECTING</div>
        </div>
      </div>
      <div class="hud-divider"></div>
      <div class="hud-stats">
        <div class="stat">
          <div class="stat-ring-wrap">
            <svg class="stat-ring" viewBox="0 0 36 36">
              <circle class="stat-ring-bg" cx="18" cy="18" r="15.9" />
              <circle class="stat-ring-fill" id="cpu-ring" cx="18" cy="18" r="15.9" stroke-dasharray="0 100" />
            </svg>
            <span class="stat-ring-val" id="cpu-val">0</span>
          </div>
          <span class="stat-name">CPU</span>
        </div>
        <div class="stat">
          <div class="stat-ring-wrap">
            <svg class="stat-ring" viewBox="0 0 36 36">
              <circle class="stat-ring-bg" cx="18" cy="18" r="15.9" />
              <circle class="stat-ring-fill" id="mem-ring" cx="18" cy="18" r="15.9" stroke-dasharray="0 100" />
            </svg>
            <span class="stat-ring-val" id="mem-val">0</span>
          </div>
          <span class="stat-name">RAM</span>
        </div>
        <div class="stat">
          <div class="stat-ring-wrap">
            <svg class="stat-ring" viewBox="0 0 36 36">
              <circle class="stat-ring-bg" cx="18" cy="18" r="15.9" />
              <circle class="stat-ring-fill" id="disk-ring" cx="18" cy="18" r="15.9" stroke-dasharray="0 100" />
            </svg>
            <span class="stat-ring-val" id="disk-val">0</span>
          </div>
          <span class="stat-name">Disk</span>
        </div>
      </div>
      <div class="hud-divider"></div>
      <div class="hud-meta">
        <div class="meta-row"><span class="meta-label">Uptime</span><span class="meta-value" id="uptime-val">--</span></div>
        <div class="meta-row"><span class="meta-label">Channels</span><span class="meta-value" id="channel-count">0</span></div>
        <div class="meta-row"><span class="meta-label">Host</span><span class="meta-value" id="hostname">--</span></div>
      </div>
      <div class="hud-divider"></div>
      <div class="hud-activity">
        <ul id="activity-feed"></ul>
      </div>
    </div>`;
}

function buildOrbital() {
  scene.className = "orbital";
  scene.innerHTML = `
    <div class="orbit-ring" id="ring1"></div>
    <div class="orbit-ring" id="ring2"></div>
    <div class="orbit-center">
      <img src="logo.png" alt="Aionima" class="logo">
      <div class="brand-name">Aionima</div>
      <div class="brand-status" id="gateway-status">CONNECTING</div>
    </div>
    <div class="satellite" id="sat-cpu">
      <div class="sat-label">CPU</div>
      <div class="sat-value" id="cpu-val">0<span class="unit">%</span></div>
      <div class="sat-bar"><div class="sat-bar-fill" id="cpu-bar"></div></div>
    </div>
    <div class="satellite" id="sat-mem">
      <div class="sat-label">Memory</div>
      <div class="sat-value" id="mem-val">0<span class="unit">%</span></div>
      <div class="sat-bar"><div class="sat-bar-fill" id="mem-bar"></div></div>
    </div>
    <div class="satellite" id="sat-disk">
      <div class="sat-label">Disk</div>
      <div class="sat-value" id="disk-val">0<span class="unit">%</span></div>
      <div class="sat-bar"><div class="sat-bar-fill" id="disk-bar"></div></div>
    </div>
    <div class="satellite" id="sat-meta">
      <div class="sat-label">System</div>
      <div style="font-size:12px;color:#bac2de">
        <div><span style="color:#6c7086">Uptime</span> <span id="uptime-val">--</span></div>
        <div><span style="color:#6c7086">Channels</span> <span id="channel-count">0</span></div>
        <div><span style="color:#6c7086">Host</span> <span id="hostname">--</span></div>
      </div>
    </div>
    <div class="satellite activity-sat" id="sat-activity">
      <div class="sat-label">Activity</div>
      <ul id="activity-feed"></ul>
    </div>`;

  // Size orbit rings
  const r1 = document.getElementById("ring1");
  const r2 = document.getElementById("ring2");
  const size1 = Math.min(innerWidth, innerHeight) * 0.45;
  const size2 = Math.min(innerWidth, innerHeight) * 0.7;
  r1.style.width = r1.style.height = size1 + "px";
  r2.style.width = r2.style.height = size2 + "px";
}

function buildMatrix() {
  scene.className = "matrix-design";
  scene.innerHTML = `
    <canvas class="matrix-canvas" id="matrix-rain"></canvas>
    <div class="center-block" id="hud">
      <img src="logo.png" alt="Aionima" class="logo">
      <div class="brand-name">AIONIMA</div>
      <div class="brand-status" id="gateway-status">CONNECTING</div>
      <div class="stats-grid">
        <div class="stat-col">
          <div class="stat-label">CPU</div>
          <div class="stat-num" id="cpu-val">0%</div>
          <div class="stat-bar"><div class="stat-bar-fill" id="cpu-bar"></div></div>
        </div>
        <div class="stat-col">
          <div class="stat-label">MEM</div>
          <div class="stat-num" id="mem-val">0%</div>
          <div class="stat-bar"><div class="stat-bar-fill" id="mem-bar"></div></div>
        </div>
        <div class="stat-col">
          <div class="stat-label">DISK</div>
          <div class="stat-num" id="disk-val">0%</div>
          <div class="stat-bar"><div class="stat-bar-fill" id="disk-bar"></div></div>
        </div>
      </div>
      <div class="meta-line"><span id="hostname">--</span> | up <span id="uptime-val">--</span> | <span id="channel-count">0</span> channels</div>
      <ul id="activity-feed"></ul>
    </div>`;

  // Initialize matrix rain
  initMatrixRain();
}

// === Matrix Rain Effect ===

let matrixColumns = [];
let matrixCtx = null;

function initMatrixRain() {
  const c = document.getElementById("matrix-rain");
  matrixCtx = c.getContext("2d");
  c.width = innerWidth;
  c.height = innerHeight;
  const fontSize = 14;
  const cols = Math.floor(c.width / fontSize);
  matrixColumns = [];
  for (let i = 0; i < cols; i++) {
    matrixColumns.push(Math.random() * c.height / fontSize | 0);
  }
}

function drawMatrixRain() {
  if (!matrixCtx) return;
  const c = matrixCtx.canvas;
  matrixCtx.fillStyle = "rgba(0, 0, 0, 0.05)";
  matrixCtx.fillRect(0, 0, c.width, c.height);
  matrixCtx.fillStyle = "#a6e3a1";
  matrixCtx.font = "14px monospace";
  const chars = "アイオニマ01AIONIMA╋╳░▓│┃┤├";
  for (let i = 0; i < matrixColumns.length; i++) {
    const char = chars[Math.random() * chars.length | 0];
    const x = i * 14;
    const y = matrixColumns[i] * 14;
    matrixCtx.globalAlpha = 0.4 + Math.random() * 0.6;
    matrixCtx.fillText(char, x, y);
    if (y > c.height && Math.random() > 0.975) {
      matrixColumns[i] = 0;
    }
    matrixColumns[i]++;
  }
  matrixCtx.globalAlpha = 1;
}

// === Drift System ===

let driftEl = null;
let driftX = 0, driftY = 0;
let driftAngle = Math.random() * Math.PI * 2;
let driftReady = false;

// Orbital satellites orbit state
const SAT_IDS = ["sat-cpu", "sat-mem", "sat-disk", "sat-meta", "sat-activity"];
let orbitAngles = [0, 1.256, 2.513, 3.77, 5.026]; // evenly spaced
let orbitRadius = 0;

function initDrift() {
  if (design === "hud-bar") {
    driftEl = document.getElementById("hud");
    const w = driftEl.offsetWidth;
    const h = driftEl.offsetHeight;
    if (w === 0 || h === 0) return;
    driftX = (innerWidth - w) / 2;
    driftY = (innerHeight - h) / 2;
    driftEl.style.left = driftX + "px";
    driftEl.style.top = driftY + "px";
    driftEl.style.transform = "none";
    driftReady = true;
  } else if (design === "orbital") {
    orbitRadius = Math.min(innerWidth, innerHeight) * 0.3;
    driftReady = true;
  } else if (design === "matrix") {
    driftEl = document.getElementById("hud");
    const w = driftEl.offsetWidth;
    const h = driftEl.offsetHeight;
    if (w === 0 || h === 0) return;
    driftX = (innerWidth - w) / 2;
    driftY = (innerHeight - h) / 2;
    driftEl.style.left = driftX + "px";
    driftEl.style.top = driftY + "px";
    driftEl.style.transform = "none";
    driftEl.style.position = "absolute";
    driftReady = true;
  }
}

function updateDrift() {
  if (!driftReady) { initDrift(); return; }

  if (design === "hud-bar" || design === "matrix") {
    const w = driftEl.offsetWidth;
    const h = driftEl.offsetHeight;
    driftAngle += (Math.random() - 0.5) * 0.015;
    driftX += Math.cos(driftAngle) * hudSpeed;
    driftY += Math.sin(driftAngle) * hudSpeed;
    if (driftX < 0) { driftX = 0; driftAngle = Math.PI - driftAngle; }
    if (driftY < 0) { driftY = 0; driftAngle = -driftAngle; }
    if (driftX + w > innerWidth) { driftX = innerWidth - w; driftAngle = Math.PI - driftAngle; }
    if (driftY + h > innerHeight) { driftY = innerHeight - h; driftAngle = -driftAngle; }
    driftEl.style.left = driftX + "px";
    driftEl.style.top = driftY + "px";
  } else if (design === "orbital") {
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const orbitSpeed = hudSpeed * 0.003;
    for (let i = 0; i < SAT_IDS.length; i++) {
      orbitAngles[i] += orbitSpeed * (0.8 + i * 0.1);
      const el = document.getElementById(SAT_IDS[i]);
      if (!el) continue;
      const r = orbitRadius * (i < 3 ? 1 : 1.4);
      const x = cx + Math.cos(orbitAngles[i]) * r - el.offsetWidth / 2;
      const y = cy + Math.sin(orbitAngles[i]) * r * 0.6 - el.offsetHeight / 2;
      el.style.left = x + "px";
      el.style.top = y + "px";
    }
  }
}

// === Sparkle Particle System ===

const canvas = document.getElementById("sparkles");
const ctx = canvas.getContext("2d");
canvas.width = innerWidth;
canvas.height = innerHeight;

window.addEventListener("resize", () => {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  if (design === "matrix" && matrixCtx) {
    matrixCtx.canvas.width = innerWidth;
    matrixCtx.canvas.height = innerHeight;
    initMatrixRain();
  }
});

const COLORS = design === "matrix"
  ? ["#a6e3a1", "#94e2d5", "#74c7ec", "#b4befe"]
  : ["#89b4fa", "#cba6f7", "#94e2d5", "#b4befe"];
const MAX_PARTICLES = 150;
const particles = [];
let isWorking = false;

function spawnParticle(x, y) {
  if (particles.length >= MAX_PARTICLES) return;
  const a = Math.random() * Math.PI * 2;
  const s = 0.5 + Math.random() * 1.5;
  particles.push({
    x, y,
    vx: Math.cos(a) * s,
    vy: Math.sin(a) * s,
    life: 1,
    decay: 0.008 + Math.random() * 0.008,
    size: 1 + Math.random() * 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  });
}

function updateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "lighter";
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// === Animation Loop ===

function tick() {
  updateDrift();

  if (design === "matrix") drawMatrixRain();

  if (isWorking) {
    const logo = scene.querySelector(".logo");
    if (logo) {
      const r = logo.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      for (let i = 0; i < 3; i++) spawnParticle(cx, cy);
    }
  }

  updateParticles();
  requestAnimationFrame(tick);
}

// === Data Layer ===

function getEl(id) { return document.getElementById(id); }

function setStatus(state) {
  const el = getEl("gateway-status");
  if (!el) return;
  el.textContent = state.toUpperCase();
  el.className = "brand-status " + state.toLowerCase();
}

function setStat(id, pct) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));

  if (design === "hud-bar") {
    const ring = getEl(id + "-ring");
    const val = getEl(id + "-val");
    if (ring) ring.setAttribute("stroke-dasharray", `${clamped} ${100 - clamped}`);
    if (val) val.textContent = clamped + "%";
  } else {
    const val = getEl(id + "-val");
    const bar = getEl(id + "-bar");
    if (val) val.innerHTML = clamped + '<span class="unit">%</span>';
    if (bar) bar.style.width = clamped + "%";
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function addActivity(type, text) {
  const feed = getEl("activity-feed");
  if (!feed) return;
  const li = document.createElement("li");
  const badge = document.createElement("span");
  badge.className = "feed-type " + type;
  badge.textContent = type === "job" ? "JOB" : "IMP";
  li.appendChild(badge);
  li.appendChild(document.createTextNode(text));
  feed.prepend(li);
  while (feed.children.length > 4) feed.removeChild(feed.lastChild);
}

// REST polling

async function fetchHealth() {
  try {
    const res = await fetch(gatewayUrl + "/health");
    const data = await res.json();
    setStatus(data.state || "online");
    const ch = getEl("channel-count");
    if (ch && data.channels != null) ch.textContent = String(data.channels);
  } catch {
    setStatus("offline");
    const ch = getEl("channel-count");
    if (ch) ch.textContent = "--";
  }
}

async function fetchStats() {
  try {
    const res = await fetch(gatewayUrl + "/api/system/stats");
    const data = await res.json();
    if (data.cpu?.usage != null) setStat("cpu", data.cpu.usage);
    if (data.memory?.percent != null) setStat("mem", data.memory.percent);
    if (data.disk?.percent != null) setStat("disk", data.disk.percent);
    const up = getEl("uptime-val");
    if (up && data.uptime != null) up.textContent = formatUptime(data.uptime);
    const host = getEl("hostname");
    if (host && data.hostname) host.textContent = data.hostname;
  } catch { /* keep last */ }
}

async function fetchJobs() {
  try {
    const res = await fetch(gatewayUrl + "/api/taskmaster/jobs");
    const data = await res.json();
    const jobs = Array.isArray(data) ? data : data.jobs || [];
    isWorking = jobs.some((j) => j.status === "running");
    const feed = getEl("activity-feed");
    jobs.slice(0, 2).forEach((j) => {
      const id = j.id || j.worker;
      if (feed && !feed.querySelector(`[data-job="${id}"]`)) {
        const li = document.createElement("li");
        li.setAttribute("data-job", id);
        const badge = document.createElement("span");
        badge.className = "feed-type job";
        badge.textContent = "JOB";
        li.appendChild(badge);
        li.appendChild(document.createTextNode(`${j.worker || j.id}: ${j.status}`));
        feed.prepend(li);
        while (feed.children.length > 4) feed.removeChild(feed.lastChild);
      }
    });
  } catch {
    isWorking = false;
  }
}

// WebSocket

let ws = null;
let wsBackoff = 3000;

function connectWs() {
  try { ws = new WebSocket(wsUrl); } catch { scheduleReconnect(); return; }
  let lastMessage = Date.now();
  ws.addEventListener("open", () => { wsBackoff = 3000; });
  ws.addEventListener("message", (event) => {
    lastMessage = Date.now();
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "overview:updated") { fetchHealth(); fetchStats(); }
      else if (msg.type === "tm:job_update") {
        const j = msg.payload || msg.data || {};
        if (j.status === "running") isWorking = true;
        addActivity("job", `${j.worker || j.id || "worker"}: ${j.status || "updated"}`);
      } else if (msg.type === "impact:recorded") {
        const d = msg.payload || msg.data || {};
        addActivity("impact", d.summary || d.description || "Impact recorded");
      }
    } catch { /* ignore */ }
  });
  ws.addEventListener("close", scheduleReconnect);
  ws.addEventListener("error", () => ws && ws.close());
  const staleCheck = setInterval(() => {
    if (Date.now() - lastMessage > 45000) { clearInterval(staleCheck); if (ws) ws.close(); }
  }, 10000);
}

function scheduleReconnect() {
  setTimeout(connectWs, wsBackoff);
  wsBackoff = Math.min(wsBackoff * 2, 30000);
}

// === Boot ===

async function boot() {
  await loadConfig();

  if (design === "orbital") buildOrbital();
  else if (design === "matrix") buildMatrix();
  else buildHudBar();

  requestAnimationFrame(tick);

  fetchHealth();
  fetchStats();
  fetchJobs();
  setInterval(fetchHealth, 10000);
  setInterval(fetchStats, 15000);
  setInterval(fetchJobs, 30000);
  connectWs();
}

boot();
