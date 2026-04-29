/**
 * ChatFlyout — Right-side slide-in chat panel with multi-session tabs and drawers.
 *
 * Replaces the old full-page Chat view. Supports multiple concurrent chat sessions,
 * project/general context per tab, and a collapsible drawer system with Quick Replies.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Chat content now renders via react-fancy's ContentRenderer (see imports
// below). The legacy ReactMarkdown + markdownComponents path was retired
// in favor of ContentRenderer + registered extensions (thinking, question,
// callout, highlight). See src/lib/content-renderer-setup.tsx.
import type { WorkerJobSummary, Plan, PlanStatus, PlanStep, ProjectInfo, Notification } from "../types.js";
import { approveTaskmasterJob, fetchTaskmasterJobs, rejectTaskmasterJob } from "../api.js";
import { AccordionFlyout } from "./AccordionFlyout.js";
import { AgentCanvas, type CanvasSurface } from "./AgentCanvas.js";
import { useDashboardWS } from "../hooks.js";
import { ToolCards, LiveToolCards, SingleToolCard } from "./ToolCards.js";
import type { ToolCard } from "./ToolCards.js";
import { PlanViewer } from "./PlanViewer.js";
import { ChatHistory } from "./ChatHistory.js";
import { applyInjectionConsumed, shouldShowLivePill, applyStallTimeout, groupByThoughtBoundary } from "./chat-flyout-reducers.js";
import type { ChatSessionShape, ChatMessageShape } from "./chat-flyout-reducers.js";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile, useConfig } from "@/hooks.js";
import { ContentRenderer, Textarea } from "@particle-academy/react-fancy";
import { Copy as CopyIcon, Check as CheckIcon } from "lucide-react";
import { PlansDrawer } from "./PlansDrawer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant" | "tool" | "thought";
  content: string;
  timestamp: string;
  runId?: string;
  /** Base64 data URLs for attached images (user messages only). */
  images?: string[];
  /** Legacy: frozen tool cards (assistant messages only — pre-runId sessions). */
  toolCards?: ToolCard[];
  /** Single tool card data (for role: "tool" messages). */
  toolCard?: ToolCard;
  /** Next-step suggestions generated for this assistant turn. Persisted server-side so they survive reload. */
  suggestions?: string[];
  /** Routing metadata from the Intelligent Agent Router. Only present on assistant messages. */
  routingMeta?: {
    provider: string;
    model: string;
    costMode: string;
    complexity?: string;
    escalated: boolean;
    estimatedCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    /** Dynamic-context request type (chat/project/entity/knowledge/system/worker/taskmaster). */
    requestType?: string;
    /** How the request type was determined. */
    classifierUsed?: string;
    /** Context layers included in the assembled system prompt. */
    contextLayers?: string[];
    /** Per-section token breakdown for this turn. */
    tokenBreakdown?: {
      identity: number;
      context: number;
      memory: number;
      skills: number;
      history: number;
      response: number;
    };
  };
}

interface ChatSession {
  id: string;
  context: string; // "general" or project path
  contextLabel: string; // "General" or project name
  messages: ChatMessage[];
  thinking: boolean;
  pendingMessages: number;
  suggestions: string[];
  toolActivity: ToolCard[];
  activePlan: Plan | null;
  progressText?: string;
  /** Run ID for the current active invocation. */
  activeRunId?: string;
  /** Messages queued for mid-loop injection (sent while agent is thinking). */
  queuedMessages: Array<{ text: string; timestamp: string }>;
}

type DrawerTab = "work-queue" | "project-info" | "plans";

// ---------------------------------------------------------------------------
// Run grouping — groups consecutive messages sharing the same runId
// ---------------------------------------------------------------------------

interface RunGroup {
  runId: string | undefined;
  messages: Array<ChatMessage & { _idx: number }>;
}

function groupByRun(messages: ChatMessage[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const rid = msg.runId;
    const last = groups[groups.length - 1];
    if (rid && last?.runId === rid) {
      last.messages.push({ ...msg, _idx: i });
    } else {
      groups.push({ runId: rid, messages: [{ ...msg, _idx: i }] });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// File Attachments
// ---------------------------------------------------------------------------

interface FileAttachment {
  id: string;
  name: string;
  type: "text" | "image" | "document";
  mimeType: string;
  content: string; // text content, data URL for images, or base64 for documents
  size: number;
}

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".json", ".md", ".csv", ".txt",
  ".html", ".css", ".scss", ".yaml", ".yml", ".toml", ".xml", ".sql",
  ".sh", ".bash", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".rb",
  ".lua", ".zig", ".svelte", ".vue", ".env", ".conf", ".ini", ".cfg",
  ".log", ".gitignore", ".dockerignore", ".editorconfig", ".prettierrc",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (PDFs can be large)

let _attachIdCounter = 0;
function generateAttachmentId(): string {
  return `att-${Date.now()}-${String(++_attachIdCounter)}`;
}

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  return TEXT_EXTENSIONS.has(getFileExtension(file.name));
}

function isImageFile(file: File): boolean {
  return IMAGE_MIME_TYPES.has(file.type);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChatFlyoutProps {
  open: boolean;
  onClose: () => void;
  theme?: "light" | "dark";
  projects: ProjectInfo[];
  /** When set (non-null), opens a new session scoped to this context. Cleared after use. */
  openWithContext?: string | null;
  /** When set alongside openWithContext, auto-sends this message once the session is ready. */
  openWithMessage?: string | null;
  /** Unique request ID — each change forces a fresh session (for "Fix this" dedup). */
  openRequestId?: string | null;
  /** When true, renders as an inline flex child instead of a fixed overlay. */
  docked?: boolean;
  /** s124 cycle 86 rework — global notification list. ChatFlyout filters
   *  to iterative-work entries matching the active session's project path
   *  and renders the latest as an inline IterativeWorkArtifactCard at the
   *  top of the message list. Per-project scoping per the owner's
   *  clarification "display everything in the toast or canvas for the
   *  project the response belongs to." */
  notifications?: Notification[];
}

// ---------------------------------------------------------------------------
// TokenBreakdownModal — per-turn token section breakdown
// ---------------------------------------------------------------------------

interface TokenBreakdownEntry {
  label: string;
  tokens: number;
  description: string;
}

function TokenBreakdownModal({
  open,
  onClose,
  breakdown,
  totalIn,
  totalOut,
}: {
  open: boolean;
  onClose: () => void;
  breakdown: NonNullable<ChatMessage["routingMeta"]>["tokenBreakdown"] | undefined;
  totalIn: number;
  totalOut: number;
}) {
  if (!open) return null;

  const rows: TokenBreakdownEntry[] = breakdown
    ? [
        { label: "Identity", tokens: breakdown.identity, description: "Persona, tools manifest, owner context, response format" },
        { label: "Context", tokens: breakdown.context, description: "Entity, COA, project, state constraints, knowledge index" },
        { label: "Memory", tokens: breakdown.memory, description: "Recalled memories injected from entity memory store" },
        { label: "Skills", tokens: breakdown.skills, description: "Matched skill snippets injected into the prompt" },
        { label: "History", tokens: breakdown.history, description: "Conversation history window passed to the model" },
        { label: "Response", tokens: breakdown.response, description: "Model output tokens for this turn" },
      ]
    : [];

  const promptTotal = rows.slice(0, -1).reduce((s, r) => s + r.tokens, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm w-full">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Token Breakdown</DialogTitle>
        </DialogHeader>
        {breakdown ? (
          <div className="mt-2 space-y-3">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left pb-1 font-normal">Section</th>
                  <th className="text-right pb-1 font-normal">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((row) => (
                  <tr key={row.label} title={row.description}>
                    <td className="py-1 text-foreground/80">{row.label}</td>
                    <td className="py-1 text-right tabular-nums">{row.tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-border pt-2 text-[10px] font-mono text-muted-foreground space-y-0.5">
              <div className="flex justify-between">
                <span>Prompt total (est.)</span>
                <span className="tabular-nums">{promptTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Reported in / out</span>
                <span className="tabular-nums">{totalIn.toLocaleString()} / {totalOut.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">Breakdown not available for this turn.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatFlyout({ open, onClose, theme = "dark", projects, openWithContext, openWithMessage, openRequestId, docked = false, notifications: notificationsProp }: ChatFlyoutProps) {
  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const deferredCreateRef = useRef(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<DrawerTab | null>(null);
  // When a plan is selected from the Plans drawer, its id is held here so
  // the PlanPane renders to the left of the chat. Cleared by the pane's X.
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tokenBreakdownMsg, setTokenBreakdownMsg] = useState<ChatMessage | null>(null);
  const isMobile = useIsMobile();

  // Display names for chat bubbles. User name comes from the gateway config's
  // owner.displayName; falls back to "You". Agent name is "Aion" for now —
  // agent.displayName is a future config knob.
  const configHook = useConfig();
  const userLabel = (configHook.data?.owner as { displayName?: string } | undefined)?.displayName?.trim() || "You";
  const agentLabel = "Aion";

  // File attachments
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // WS ref
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContextRef = useRef<string | null>(null);
  const pendingMessageRef = useRef<string | null>(null);

  // Scroll refs
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  /** s124 cycle 86 rework — most-recent iterative-work artifact for the active
   *  session's project. Filters the global notifications stream by type
   *  + matching projectPath; takes the newest. Null when no recent artifact
   *  applies to this chat session (e.g., session is not project-scoped, or
   *  no iteration has fired since the session opened). */
  const latestIterationArtifact = useMemo(() => {
    if (notificationsProp === undefined) return null;
    if (activeSession === null) return null;
    const projectPath = activeSession.context;
    if (typeof projectPath !== "string" || projectPath.length === 0) return null;

    let candidate: Notification | null = null;
    for (const n of notificationsProp) {
      if (n.type !== "iterative-work") continue;
      const meta = n.metadata as { projectPath?: string } | null;
      if (meta?.projectPath !== projectPath) continue;
      if (candidate === null || new Date(n.createdAt).getTime() > new Date(candidate.createdAt).getTime()) {
        candidate = n;
      }
    }
    return candidate;
  }, [notificationsProp, activeSession]);

  // -------------------------------------------------------------------------
  // File attachment handlers
  // -------------------------------------------------------------------------

  const processFiles = useCallback((files: File[]) => {
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`File "${file.name}" exceeds 512 KB limit`);
        continue;
      }

      if (isTextFile(file)) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) => [...prev, {
            id: generateAttachmentId(),
            name: file.name,
            type: "text",
            mimeType: file.type || "text/plain",
            content: reader.result as string,
            size: file.size,
          }]);
        };
        reader.readAsText(file);
      } else if (isImageFile(file)) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) => [...prev, {
            id: generateAttachmentId(),
            name: file.name,
            type: "image",
            mimeType: file.type,
            content: reader.result as string,
            size: file.size,
          }]);
        };
        reader.readAsDataURL(file);
      } else if (DOCUMENT_MIME_TYPES.has(file.type)) {
        // PDFs and other documents — send as base64 document blocks
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) => [...prev, {
            id: generateAttachmentId(),
            name: file.name,
            type: "document",
            mimeType: file.type,
            content: reader.result as string,
            size: file.size,
          }]);
        };
        reader.readAsDataURL(file);
      } else {
        // Unknown file type — try reading as text, fall back to base64
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          // If it looks like binary (lots of null bytes or non-printable chars), skip
          // oxlint-disable-next-line no-control-regex
          const nonPrintable = (text.match(/[\x00-\x08\x0E-\x1F]/g) ?? []).length;
          if (nonPrintable > text.length * 0.1) {
            setError(`Binary file "${file.name}" — only text, images, and PDFs are supported`);
            return;
          }
          setAttachments((prev) => [...prev, {
            id: generateAttachmentId(),
            name: file.name,
            type: "text",
            mimeType: file.type || "text/plain",
            content: text,
            size: file.size,
          }]);
        };
        reader.readAsText(file);
      }
    }
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      processFiles(files);
    }
    // If no files, let default paste behavior through
  }, [processFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFiles(Array.from(files));
    }
    // Reset so the same file can be selected again
    e.target.value = "";
  }, [processFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // -------------------------------------------------------------------------
  // Stall detection — if no WS traffic arrives for STALL_MS while a session is
  // "thinking", surface a timeout message so the UI isn't stuck until reload.
  // -------------------------------------------------------------------------

  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-session high-water mark of the server's chat event seq numbers.
  // Used for chat:resume on WS reconnect — we send { lastSeq } and the server
  // replays any events newer than that. Without this, events emitted during a
  // brief WS drop are lost (terminal chat:response in particular) and the
  // client stalls waiting for something the server already "sent" to a dead
  // connection.
  const lastSeqBySession = useRef<Map<string, number>>(new Map());

  // WS heartbeat: we ping every HEARTBEAT_INTERVAL; if the server doesn't
  // pong within HEARTBEAT_TIMEOUT we assume the WS is a TCP zombie (looks
  // alive but no data flows) and force-reconnect. On reconnect chat:resume
  // replays any missed events, so the user doesn't have to reload the page
  // when the network glitches or the laptop sleeps.
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongAtRef = useRef<number>(Date.now());
  const HEARTBEAT_INTERVAL_MS = 15_000;
  const HEARTBEAT_TIMEOUT_MS = 25_000;
  const STALL_MS = 120_000;

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const resetStallTimer = useCallback((sessionId: string) => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = setTimeout(() => {
      setSessions((prev) => prev.map((s) =>
        s.id === sessionId
          ? (applyStallTimeout(
              s as unknown as ChatSessionShape,
              "Response timed out \u2014 the connection may have dropped. Try sending again.",
              new Date().toISOString(),
            ) as unknown as ChatSession)
          : s
      ));
      stallTimerRef.current = null;
    }, STALL_MS);
  }, []);

  // -------------------------------------------------------------------------
  // WebSocket connection
  // -------------------------------------------------------------------------

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Refresh server's ownerConnectionMap for this entity — any message works,
      // and ping is a no-side-effect handler on the server side.
      ws.send(JSON.stringify({ type: "ping" }));
      lastPongAtRef.current = Date.now();
      // Resume any active sessions — server will replay any chat:* events the
      // client missed while the WS was down. For first connect the map is empty
      // and nothing is sent.
      for (const [sessionId, lastSeq] of lastSeqBySession.current.entries()) {
        ws.send(JSON.stringify({
          type: "chat:resume",
          payload: { sessionId, lastSeq },
        }));
      }
      // Flush any pending openWithContext that arrived before WS was ready
      const pending = pendingContextRef.current;
      if (pending) {
        pendingContextRef.current = null;
        ws.send(JSON.stringify({ type: "chat:open", payload: { context: pending } }));
      }
      // If a deferred session create was queued (from + button before WS ready), flush it
      if (deferredCreateRef.current) {
        deferredCreateRef.current = false;
        ws.send(JSON.stringify({ type: "chat:open", payload: { context: "general" } }));
      }
      // Start heartbeat. Every tick we ping; if we haven't seen a pong within
      // HEARTBEAT_TIMEOUT_MS we declare the WS dead and force-close it so the
      // reconnect path runs (ws.onclose -> 3s reconnect timer -> new WS).
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = setInterval(() => {
        if (wsRef.current !== ws) return;
        const gap = Date.now() - lastPongAtRef.current;
        if (gap > HEARTBEAT_TIMEOUT_MS) {
          // TCP zombie — kill it so we reconnect.
          try { ws.close(); } catch { /* noop */ }
          return;
        }
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* noop */ }
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; payload?: unknown };
        const payload = msg.payload as Record<string, unknown> | undefined;
        const sid = payload?.sessionId as string | undefined;

        // Any incoming message proves the WS is alive — update the heartbeat.
        // `pong` specifically is the response to our periodic ping.
        lastPongAtRef.current = Date.now();

        // Track the server's seq high-water mark per session for chat:resume on
        // the next reconnect. Only chat:* events carry a seq (via the server's
        // recordAndSendChat helper).
        if (sid !== undefined && msg.type.startsWith("chat:") && typeof payload?.seq === "number") {
          const prevSeq = lastSeqBySession.current.get(sid) ?? 0;
          if (payload.seq > prevSeq) lastSeqBySession.current.set(sid, payload.seq);
        }

        // Stall-timer bookkeeping: any mid-run activity resets; terminal events clear.
        if (msg.type === "chat:response" || msg.type === "chat:error" || msg.type === "chat:cancelled") {
          clearStallTimer();
        } else if (sid !== undefined && (
          msg.type === "chat:thinking" ||
          msg.type === "chat:thought" ||
          msg.type === "chat:tool_start" ||
          msg.type === "chat:tool_result" ||
          msg.type === "chat:progress" ||
          msg.type === "chat:inject_ack" ||
          msg.type === "chat:injection_consumed"
        )) {
          resetStallTimer(sid);
        }

        switch (msg.type) {
          case "chat:opened": {
            const p = payload as { sessionId: string; context: string; contextLabel?: string; messages: ChatMessage[] };
            setSessions((prev) => {
              const exists = prev.find((s) => s.id === p.sessionId);
              if (exists) return prev;
              const contextLabel = p.contextLabel
                ?? (p.context === "general"
                  ? "General"
                  : projects.find((pr) => pr.path === p.context)?.name ?? p.context.split("/").pop() ?? "Project");
              // Hydrate session suggestions from the LAST assistant message's
              // stored suggestions so they survive a page reload. Previously
              // session.suggestions was reset to [] on load and the button
              // row silently disappeared.
              const hydratedMsgs = p.messages ?? [];
              let hydratedSuggestions: string[] = [];
              for (let i = hydratedMsgs.length - 1; i >= 0; i--) {
                const m = hydratedMsgs[i]!;
                if (m.role === "assistant") {
                  hydratedSuggestions = m.suggestions ?? [];
                  break;
                }
              }
              return [...prev, {
                id: p.sessionId,
                context: p.context,
                contextLabel,
                messages: hydratedMsgs,
                thinking: false,
                pendingMessages: 0,
                suggestions: hydratedSuggestions,
                toolActivity: [],
                activePlan: null,
                progressText: undefined,
                queuedMessages: [],
              }];
            });
            setActiveSessionId(p.sessionId);

            // Auto-send pending message from "Fix this" (or similar pre-loaded context)
            const pendingMsg = pendingMessageRef.current;
            if (pendingMsg) {
              pendingMessageRef.current = null;
              const ts = new Date().toISOString();
              setSessions((prev) => prev.map((s) =>
                s.id === p.sessionId
                  ? { ...s, messages: [...s.messages, { role: "user" as const, content: pendingMsg, timestamp: ts }], suggestions: [] }
                  : s
              ));
              ws.send(JSON.stringify({
                type: "chat:send",
                payload: { sessionId: p.sessionId, text: pendingMsg, context: p.context },
              }));
            }
            break;
          }
          case "chat:thinking": {
            if (!sid) break;
            const thinkRunId = (payload as { runId?: string })?.runId;
            setSessions((prev) => prev.map((s) => {
              if (s.id !== sid) return s;
              // Retroactively stamp runId on the last user message if it doesn't have one.
              let msgs = s.messages;
              if (thinkRunId) {
                const lastIdx = msgs.length - 1;
                if (lastIdx >= 0 && msgs[lastIdx]!.role === "user" && !msgs[lastIdx]!.runId) {
                  msgs = [...msgs];
                  msgs[lastIdx] = { ...msgs[lastIdx]!, runId: thinkRunId };
                }
              }
              return { ...s, messages: msgs, thinking: true, suggestions: [], activeRunId: thinkRunId };
            }));
            setError(null);
            break;
          }
          case "chat:thought": {
            const p = payload as { sessionId?: string; runId?: string; content: string; timestamp: string };
            if (!p.sessionId) break;
            setSessions((prev) => prev.map((s) => {
              if (s.id !== p.sessionId) return s;
              return {
                ...s,
                messages: [...s.messages, {
                  role: "thought" as const,
                  content: p.content,
                  timestamp: p.timestamp,
                  runId: p.runId ?? s.activeRunId,
                }],
              };
            }));
            break;
          }
          case "chat:inject_ack": {
            // Acknowledgement that injection was queued — no-op for now
            break;
          }
          case "chat:resumed": {
            // Server has replayed any missed events; nothing to do here beyond
            // accepting the seq high-water from the server (already tracked by
            // the seq bookkeeping above).
            break;
          }
          case "chat:resume_missed": {
            // Server can't replay — most likely a gateway restart wiped the
            // buffer. Clear the thinking state so the UI doesn't hang waiting
            // for a terminal event that will never come, and surface an error
            // so the user knows to re-send if the previous turn was lost.
            const p = payload as { sessionId?: string } | undefined;
            if (p?.sessionId) {
              lastSeqBySession.current.delete(p.sessionId);
              setSessions((prev) => prev.map((s) =>
                s.id === p.sessionId
                  ? { ...s, thinking: false, toolActivity: [], progressText: undefined }
                  : s
              ));
              setError("We lost sight of your last message (the gateway may have restarted). Your next message will start a fresh exchange.");
            }
            break;
          }
          case "chat:injection_consumed": {
            // Server signals that the agent has woven N queued injections into the current run.
            // Move them from queuedMessages into messages so they appear inline in the run timeline.
            const p = payload as { sessionId?: string; count?: number };
            if (!p.sessionId || typeof p.count !== "number" || p.count <= 0) break;
            setSessions((prev) => prev.map((s) =>
              s.id === p.sessionId
                ? (applyInjectionConsumed(s as unknown as ChatSessionShape, p.count ?? 0) as unknown as ChatSession)
                : s
            ));
            break;
          }
          case "chat:context_set": {
            const p = payload as { sessionId: string; context: string; contextLabel: string };
            setSessions((prev) => prev.map((s) =>
              s.id === p.sessionId ? { ...s, context: p.context, contextLabel: p.contextLabel } : s
            ));
            break;
          }
          case "chat:tool_start": {
            const p = payload as { sessionId: string; runId?: string; toolName: string; toolIndex: number; loopIteration: number; toolInput?: Record<string, unknown>; timestamp: string };
            if (!p.sessionId) break;
            const toolCardData: ToolCard = {
              id: `${p.sessionId}-${String(p.loopIteration)}-${String(p.toolIndex ?? 0)}`,
              toolName: p.toolName,
              loopIteration: p.loopIteration,
              toolIndex: p.toolIndex ?? 0,
              status: "running" as const,
              toolInput: p.toolInput,
              timestamp: p.timestamp,
            };
            setSessions((prev) => prev.map((s) => {
              if (s.id !== p.sessionId) return s;
              return {
                ...s,
                toolActivity: [...s.toolActivity, toolCardData],
                messages: [...s.messages, {
                  role: "tool" as const,
                  content: p.toolName,
                  timestamp: p.timestamp,
                  runId: p.runId ?? s.activeRunId,
                  toolCard: toolCardData,
                }],
              };
            }));
            break;
          }
          case "chat:tool_result": {
            const p = payload as { sessionId: string; runId?: string; toolName: string; toolIndex?: number; loopIteration: number; success: boolean; summary?: string; detail?: Record<string, unknown>; timestamp: string };
            if (!p.sessionId) break;
            setSessions((prev) => prev.map((s) => {
              if (s.id !== p.sessionId) return s;
              const updatedStatus = (p.success ? "complete" : "error") as "complete" | "error";
              // Update toolActivity (for the thinking indicator)
              const updatedActivity = s.toolActivity.map((t) =>
                t.toolName === p.toolName && t.loopIteration === p.loopIteration && t.status === "running"
                  ? { ...t, status: updatedStatus, summary: p.summary, detail: p.detail, completedAt: p.timestamp }
                  : t
              );
              // Update the matching tool message in messages
              const targetId = `${p.sessionId}-${String(p.loopIteration)}-${String(p.toolIndex ?? 0)}`;
              const updatedMessages = s.messages.map((m) =>
                m.role === "tool" && m.toolCard?.id === targetId
                  ? { ...m, toolCard: { ...m.toolCard, status: updatedStatus, summary: p.summary, detail: p.detail, completedAt: p.timestamp } }
                  : m
              );
              return { ...s, toolActivity: updatedActivity, messages: updatedMessages };
            }));
            break;
          }
          case "chat:progress": {
            const p = payload as { sessionId?: string; text: string };
            if (!p.sessionId) break;
            setSessions((prev) => prev.map((s) =>
              s.id === p.sessionId ? { ...s, progressText: p.text } : s
            ));
            break;
          }
          case "chat:response": {
            const p = payload as {
              sessionId?: string;
              runId?: string;
              text: string;
              timestamp: string;
              suggestions?: string[];
              routingMeta?: {
                provider: string;
                model: string;
                costMode: string;
                escalated: boolean;
                estimatedCostUsd: number;
                requestType?: string;
                classifierUsed?: string;
                contextLayers?: string[];
              };
            };
            if (!p.sessionId) break;
            setSessions((prev) => prev.map((s) => {
              if (s.id !== p.sessionId) return s;
              const hasPending = s.pendingMessages > 0;
              // Move queued messages into the main message history
              const queuedAsMsgs: ChatMessage[] = s.queuedMessages.map((q) => ({
                role: "user" as const,
                content: q.text,
                timestamp: q.timestamp,
                runId: s.activeRunId,
              }));
              return {
                ...s,
                thinking: hasPending,
                pendingMessages: hasPending ? s.pendingMessages - 1 : 0,
                toolActivity: [],
                progressText: undefined,
                activeRunId: undefined,
                queuedMessages: [],
                // Persist suggestions and routing metadata onto the assistant
                // message so a reload finds them via the chat-history fetch.
                messages: [...s.messages, ...queuedAsMsgs, {
                  role: "assistant" as const,
                  content: p.text,
                  timestamp: p.timestamp,
                  runId: p.runId ?? s.activeRunId,
                  suggestions: p.suggestions && p.suggestions.length > 0 ? p.suggestions : undefined,
                  routingMeta: p.routingMeta,
                }],
                // Mirror onto the session for the suggestion-button row below
                // the latest response.
                suggestions: p.suggestions ?? s.suggestions,
              };
            }));
            break;
          }
          case "chat:suggestions": {
            const p = payload as { sessionId?: string; suggestions: string[] };
            if (!p.sessionId) break;
            setSessions((prev) => prev.map((s) =>
              s.id === p.sessionId ? { ...s, suggestions: p.suggestions } : s
            ));
            break;
          }
          case "chat:error": {
            const p = payload as { sessionId?: string; error: string };
            if (p.sessionId) {
              setSessions((prev) => prev.map((s) =>
                s.id === p.sessionId ? { ...s, thinking: false } : s
              ));
            }
            setError(p.error);
            break;
          }
          case "chat:cancelled": {
            const p = payload as { sessionId?: string };
            if (p.sessionId) {
              setSessions((prev) => prev.map((s) =>
                s.id === p.sessionId ? { ...s, thinking: false, toolActivity: [], progressText: undefined } : s
              ));
            }
            break;
          }
          case "chat:plan_created": {
            const p = payload as { sessionId: string; plan: Plan };
            if (!p.sessionId) break;
            setSessions((prev) => prev.map((s) =>
              s.id === p.sessionId ? { ...s, activePlan: p.plan } : s
            ));
            // Auto-open the PlanPane when a new plan arrives for the
            // currently-active session. This is the piece the previous
            // Plans-tab shipment left as a follow-up; without it the
            // user has to hunt for the plan manually. Suppressed for
            // background sessions to avoid surprise drawer flips.
            if (p.sessionId === activeSessionId && open) {
              setSelectedPlanId(p.plan.id);
              setActiveDrawer("plans");
            }
            break;
          }
          case "chat:plan_status": {
            const p = payload as { sessionId: string; planId: string; status: PlanStatus; steps?: PlanStep[] };
            if (!p.sessionId) break;
            setSessions((prev) => prev.map((s) => {
              if (s.id !== p.sessionId || !s.activePlan || s.activePlan.id !== p.planId) return s;
              return {
                ...s,
                activePlan: {
                  ...s.activePlan,
                  status: p.status,
                  steps: p.steps ?? s.activePlan.steps,
                },
              };
            }));
            break;
          }
          case "chat:closed": {
            // Session closed confirmation - already removed from UI on close click
            break;
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      if (wsRef.current === ws) {
        reconnectTimer.current = setTimeout(() => {
          if (wsRef.current === ws || wsRef.current === null) connect();
        }, 3000);
      }
    };

    ws.onerror = () => {};
  }, [projects]);

  useEffect(() => {
    if (!open) return;
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [open, connect]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const createSession = useCallback((context = "general") => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      deferredCreateRef.current = true;
      return;
    }
    ws.send(JSON.stringify({ type: "chat:open", payload: { context } }));
  }, []);

  const sendMessage = useCallback((text: string) => {
    const hasText = text.trim().length > 0;
    const hasAttachments = attachments.length > 0;
    if ((!hasText && !hasAttachments) || !activeSession) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Build the full message text with file contents appended
    let fullText = text;
    const textFiles = attachments.filter((a) => a.type === "text");
    const imageFiles = attachments.filter((a) => a.type === "image");

    for (const file of textFiles) {
      const ext = getFileExtension(file.name).replace(".", "") || "txt";
      fullText += `\n\n\`\`\`${ext} ${file.name}\n${file.content}\n\`\`\``;
    }

    // Display text: user's typed text + summary of attachments
    let displayText = text;
    if (hasAttachments) {
      const names = attachments.map((a) => a.name).join(", ");
      const summary = `[${String(attachments.length)} file${attachments.length > 1 ? "s" : ""} attached: ${names}]`;
      displayText = hasText ? `${text}\n${summary}` : summary;
    }

    // Build media arrays for the WS payload
    const documentFiles = attachments.filter((a) => a.type === "document");
    const imagePayloads = imageFiles.map((img) => ({
      data: img.content,
      mediaType: img.mimeType,
    }));
    const documentPayloads = documentFiles.map((doc) => ({
      data: doc.content,
      mediaType: doc.mimeType,
      name: doc.name,
    }));

    const timestamp = new Date().toISOString();
    const wasThinking = activeSession.thinking;

    if (wasThinking) {
      // Agent is working — queue message for mid-loop injection
      setSessions((prev) => prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              queuedMessages: [...s.queuedMessages, { text: displayText, timestamp }],
              pendingMessages: s.pendingMessages + 1,
            }
          : s
      ));
      setError(null);
      ws.send(JSON.stringify({
        type: "chat:inject",
        payload: {
          sessionId: activeSession.id,
          text: fullText,
        },
      }));
    } else {
      // Normal send path
      setSessions((prev) => prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              messages: [...s.messages, {
                role: "user" as const,
                content: displayText,
                timestamp,
                images: imageFiles.map((img) => img.content),
              }],
              suggestions: [],
            }
          : s
      ));
      setError(null);
      ws.send(JSON.stringify({
        type: "chat:send",
        payload: {
          sessionId: activeSession.id,
          text: fullText,
          context: activeSession.context,
          ...(imagePayloads.length > 0 ? { images: imagePayloads } : {}),
          ...(documentPayloads.length > 0 ? { documents: documentPayloads } : {}),
        },
      }));
    }
    setInput("");
    setAttachments([]);
  }, [activeSession, attachments]);

  const cancelInvocation = useCallback(() => {
    if (!activeSession) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat:cancel", payload: { sessionId: activeSession.id } }));
    setSessions((prev) => prev.map((s) =>
      s.id === activeSession.id ? { ...s, thinking: false, toolActivity: [] } : s
    ));
  }, [activeSession]);

  const closeSession = useCallback((sessionId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "chat:close", payload: { sessionId } }));
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setActiveSessionId((prev) => {
      if (prev === sessionId) {
        const remaining = sessions.filter((s) => s.id !== sessionId);
        return remaining.length > 0 ? remaining[remaining.length - 1]!.id : null;
      }
      return prev;
    });
  }, [sessions]);

  const resumeSession = useCallback((sessionId: string, context: string) => {
    // Check if session is already open
    const existing = sessions.find((s) => s.id === sessionId);
    if (existing) {
      setActiveSessionId(existing.id);
      return;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat:open", payload: { sessionId, context } }));
  }, [sessions]);

  const approvePlan = useCallback((planId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !activeSession) return;
    ws.send(JSON.stringify({
      type: "chat:plan_approve",
      payload: { sessionId: activeSession.id, planId },
    }));
  }, [activeSession]);

  const rejectPlan = useCallback((planId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !activeSession) return;
    ws.send(JSON.stringify({
      type: "chat:plan_reject",
      payload: { sessionId: activeSession.id, planId },
    }));
  }, [activeSession]);

  // Auto-scroll + unread counter for the jump-to-bottom button.
  // lastSeenCountRef captures the message count at the moment the user was
  // last pinned to the bottom. `unreadCount` = current - lastSeen while the
  // user is scrolled up. Clearing: auto-resets whenever the user scrolls
  // back to within 60px of the bottom OR clicks the Jump button.
  const lastSeenCountRef = useRef(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(pinned);
    if (pinned) {
      lastSeenCountRef.current = activeSession?.messages.length ?? 0;
      setUnreadCount(0);
    }
  }, [activeSession?.messages.length]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setAutoScroll(true);
    lastSeenCountRef.current = activeSession?.messages.length ?? 0;
    setUnreadCount(0);
  }, [activeSession?.messages.length]);

  useEffect(() => {
    const count = activeSession?.messages.length ?? 0;
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      lastSeenCountRef.current = count;
      setUnreadCount(0);
    } else {
      // Messages arrived while scrolled up — surface how many we haven't seen.
      setUnreadCount(Math.max(0, count - lastSeenCountRef.current));
    }
  }, [activeSession?.messages, activeSession?.thinking, autoScroll]);

  // Create first session on open if none exist (skip when openWithContext will handle it)
  useEffect(() => {
    if (open && sessions.length === 0 && !openWithContext && !pendingContextRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      createSession();
    }
  }, [open, sessions.length, openWithContext, createSession]);

  // Open with context — create a session scoped to a specific project
  const prevContextRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !openWithContext || openWithContext === prevContextRef.current) return;
    prevContextRef.current = openWithContext;
    // Check if there's already a session for this context
    const existing = sessions.find((s) => s.context === openWithContext);
    if (existing) {
      setActiveSessionId(existing.id);
      return;
    }
    // If WS isn't connected yet, stash the context — onopen will flush it
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      pendingContextRef.current = openWithContext;
      return;
    }
    createSession(openWithContext);
  }, [open, openWithContext, sessions, createSession]);

  // Open with context + message — "Fix this" creates a fresh session and auto-sends
  const prevRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !openWithContext || !openRequestId || openRequestId === prevRequestRef.current) return;
    prevRequestRef.current = openRequestId;
    // Stash the message to be sent after session is confirmed open
    pendingMessageRef.current = openWithMessage ?? null;
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      pendingContextRef.current = openWithContext;
      return;
    }
    createSession(openWithContext);
  }, [open, openWithContext, openWithMessage, openRequestId, createSession]);

  // Reset context guards when the flyout closes so reopening with the same context re-triggers the effects above.
  useEffect(() => {
    if (!open) {
      prevContextRef.current = null;
      prevRequestRef.current = null;
    }
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }, [input, sendMessage]);

  // Clear attachments when switching sessions
  useEffect(() => {
    setAttachments([]);
  }, [activeSessionId]);

  // -------------------------------------------------------------------------
  // (Markdown rendering lives in ContentRenderer now — see the rendering
  // section below. The legacy markdownComponents form-answer handler was
  // retired; interactive <question> submissions via the new extension are
  // a follow-up once the extension accepts a sendMessage callback through
  // a context bridge.)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Derived send-button state
  // -------------------------------------------------------------------------

  const canSend = activeSession != null
    && (input.trim().length > 0 || attachments.length > 0);

  if (!open && !docked) return null;

  // Shared header for docked and overlay modes
  const panelHeader = (
    <div className="flex items-center justify-between px-4 py-[10px] bg-card border-b border-border shrink-0">
      <span className="font-bold text-sm text-foreground">Chat</span>
      <div className="flex gap-1.5">
        {!docked && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => setIsFullscreen((p) => !p)}
          >
            {isFullscreen ? "Restore" : "Expand"}
          </Button>
        )}
        <Button
          variant="outline"
          size="xs"
          onClick={onClose}
        >
          X
        </Button>
      </div>
    </div>
  );

  // Panel body: everything below the header (shared between docked and overlay modes)
  const panelBody = (
    <div className="relative flex flex-col flex-1 min-h-0">
        {/* Chat history overlay */}
        <ChatHistory
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onResume={resumeSession}
        />

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 bg-card border-b border-border overflow-x-auto shrink-0">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => createSession()}
            className="text-blue font-bold shrink-0 border border-border"
          >
            +
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setHistoryOpen(true)}
            className="text-muted-foreground shrink-0 border border-border text-[11px]"
            title="Chat history"
          >
            &#128337;
          </Button>
          {sessions.map((s) => (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] cursor-pointer shrink-0 max-w-[160px]",
                s.id === activeSessionId
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-foreground font-normal hover:bg-secondary",
              )}
              onClick={() => setActiveSessionId(s.id)}
            >
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                {s.contextLabel}
              </span>
              <span
                onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}
                className="text-[10px] opacity-70 cursor-pointer ml-0.5"
              >
                x
              </span>
            </div>
          ))}
        </div>

        {/* Context label (read-only — set at session creation or by manage_project tool) */}
        {activeSession && (
          <div className="px-4 py-1.5 bg-secondary text-[11px] shrink-0">
            <span className="text-muted-foreground">Context:</span>{" "}
            <span className={cn(
              "font-semibold",
              activeSession.context === "general" ? "text-muted-foreground" : "text-blue",
            )}>
              {activeSession.contextLabel}
            </span>
          </div>
        )}

        {/* Messages area */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4"
        >
          {/* s134 cycle 87 rework — iterative-work artifacts now render in
              AgentCanvas (the right-hand panel) rather than inline in chat.
              Chat stays focused on conversation; canvas hosts rich content
              like artifacts and plans. The artifact is wired into the
              canvas surface state below. */}

          {activeSession === null && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Click + to start a new chat
            </div>
          )}

          {activeSession !== null && activeSession.messages.length === 0 && !activeSession.thinking && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Start a conversation
            </div>
          )}

          {activeSession && groupByRun(activeSession.messages).map((group, gIdx) => {
            // Inside each run, further group by thought boundary so a thought
            // and the tools it produced render together under a "Step N" header.
            // Anthropic returns one thinking block per assistant response (not
            // per tool call), so this is the cleanest way to represent reality.
            const thoughtSections = groupByThoughtBoundary(
              group.messages as unknown as ChatMessageShape[],
            );
            let stepCount = 0;
            const renderMessage = (msg: ChatMessage & { _idx: number }) => {
              const idx = msg._idx;
              // Tool messages — standalone card with label
              if (msg.role === "tool" && msg.toolCard) {
                  return (
                    <div
                      key={`tool-${msg.toolCard.id}-${String(idx)}`}
                      data-role="tool"
                      className="flex flex-col items-start gap-1"
                    >
                      <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider px-1">
                        Tool: {msg.toolCard.toolName}
                      </div>
                      <div className="max-w-[85%]">
                        <SingleToolCard card={msg.toolCard} collapsed />
                      </div>
                    </div>
                  );
                }

                // Thought messages — distinct bubble with left accent; only collapse very long walls.
                if (msg.role === "thought") {
                  // Thought content is wrapped in a <thinking> tag and passed
                  // through ContentRenderer; the registered extension renders
                  // it as a collapsed purple panel. This unifies the visual
                  // language — the bubble is just another agent post, labeled
                  // with the agent's name like any other assistant message.
                  const wrapped = `<thinking>${msg.content}</thinking>`;
                  return (
                    <div
                      key={`thought-${msg.timestamp}-${String(idx)}`}
                      data-role="thought"
                      className="flex flex-col items-start gap-1"
                    >
                      <div className="text-[9px] font-semibold uppercase tracking-wider px-1 text-muted-foreground">
                        {agentLabel}
                        <span className="ml-2 font-normal opacity-60">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="max-w-[85%] px-3 py-2 rounded-[10px] bg-card text-card-foreground border border-border text-[13px] leading-relaxed break-words">
                        <ContentRenderer value={wrapped} format="html" />
                      </div>
                    </div>
                  );
                }

                // User and assistant messages
                const isUser = msg.role === "user";
                return (
                  <div
                    key={`${msg.timestamp}-${String(idx)}`}
                    data-role={isUser ? "user" : "assistant"}
                    className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
                  >
                    {/* Role label */}
                    <div className={cn("text-[9px] font-semibold uppercase tracking-wider px-1", isUser ? "text-primary/60" : "text-muted-foreground")}>
                      {isUser ? userLabel : agentLabel}
                      <span className="ml-2 font-normal opacity-60">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {/* Legacy: frozen tool cards on old assistant messages */}
                    {!isUser && msg.toolCards && msg.toolCards.length > 0 && (
                      <div className="max-w-[85%] mb-0.5">
                        <ToolCards cards={msg.toolCards} collapsed />
                      </div>
                    )}
                    {isUser ? (
                      <div className="max-w-[80%] px-3 py-2 rounded-[10px] text-[13px] leading-relaxed break-words bg-primary text-primary-foreground whitespace-pre-wrap">
                        {msg.content}
                        {msg.images && msg.images.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap mt-1.5">
                            {msg.images.map((src, imgIdx) => (
                              <img
                                key={`img-${String(imgIdx)}`}
                                src={src}
                                alt="attachment"
                                className="max-w-[200px] max-h-[160px] rounded-md object-cover"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      // Assistant bubble gets a floating copy button top-right.
                      // Click copies styled HTML + plain-text fallback; Ctrl/Cmd+Click
                      // copies the raw markdown. See AgentBubble below.
                      <>
                        <AgentBubble content={msg.content} />
                        {msg.routingMeta && (
                          <div className="flex flex-col gap-1 mt-1 px-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[9px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted/50">
                                {msg.routingMeta.model}
                              </span>
                              {msg.routingMeta.inputTokens > 0 && (
                                <button
                                  type="button"
                                  className="text-[9px] font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-0 p-0"
                                  title="Click to see token breakdown by section"
                                  onClick={() => setTokenBreakdownMsg(msg as unknown as ChatMessage)}
                                >
                                  {msg.routingMeta.inputTokens.toLocaleString()} in / {msg.routingMeta.outputTokens.toLocaleString()} out
                                </button>
                              )}
                              {msg.routingMeta.estimatedCostUsd > 0 && (
                                <span className="text-[9px] font-mono text-muted-foreground">
                                  ${msg.routingMeta.estimatedCostUsd.toFixed(4)}
                                </span>
                              )}
                              {msg.routingMeta.complexity && (
                                <span className="text-[9px] font-mono text-muted-foreground px-1 rounded bg-muted/30">
                                  {msg.routingMeta.complexity}
                                </span>
                              )}
                              {msg.routingMeta.escalated && (
                                <span className="text-[9px] text-yellow-500 font-mono">escalated</span>
                              )}
                            </div>
                            {(msg.routingMeta.requestType !== undefined || (msg.routingMeta.contextLayers?.length ?? 0) > 0) && (
                              <details className="group" data-testid="routing-details">
                                <summary className="text-[9px] font-mono text-muted-foreground cursor-pointer hover:text-foreground select-none">
                                  Routing {msg.routingMeta.requestType ? `· ${msg.routingMeta.requestType}` : ""}
                                </summary>
                                <div className="pl-3 mt-1 space-y-0.5 text-[9px] font-mono text-muted-foreground">
                                  {msg.routingMeta.requestType && (
                                    <div>
                                      <span className="text-foreground/60">type: </span>
                                      <span>{msg.routingMeta.requestType}</span>
                                      {msg.routingMeta.classifierUsed && (
                                        <span className="text-muted-foreground/60"> ({msg.routingMeta.classifierUsed})</span>
                                      )}
                                    </div>
                                  )}
                                  {(msg.routingMeta.contextLayers?.length ?? 0) > 0 && (
                                    <div>
                                      <span className="text-foreground/60">layers: </span>
                                      <span>{msg.routingMeta.contextLayers!.join(" · ")}</span>
                                    </div>
                                  )}
                                  <div>
                                    <span className="text-foreground/60">route: </span>
                                    <span>{msg.routingMeta.provider}/{msg.routingMeta.model}</span>
                                    <span className="text-muted-foreground/60"> · {msg.routingMeta.costMode}</span>
                                  </div>
                                </div>
                              </details>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              };
              return (
                <div
                  key={`run-${group.runId ?? `noid-${String(gIdx)}`}`}
                  data-testid="run-group"
                  className="flex flex-col gap-3"
                >
                  {gIdx > 0 && <div className="h-px bg-border/50 -my-1" aria-hidden />}
                  {thoughtSections.map((section, sIdx) => {
                    const isStep = section.lead?.role === "thought";
                    if (isStep) stepCount++;
                    const sectionKey = `section-${String(gIdx)}-${String(sIdx)}`;
                    return (
                      <div
                        key={sectionKey}
                        data-testid={isStep ? "thought-section" : undefined}
                        className={cn(
                          "flex flex-col gap-2",
                          isStep && "border-l-2 border-l-blue/40 pl-3",
                        )}
                      >
                        {isStep && (
                          <div className="text-[9px] text-blue/70 font-semibold uppercase tracking-[0.15em] px-1">
                            Step {String(stepCount)}
                          </div>
                        )}
                        {section.lead !== null && renderMessage(section.lead as unknown as ChatMessage & { _idx: number })}
                        {section.trail.map((m) => renderMessage(m as unknown as ChatMessage & { _idx: number }))}
                      </div>
                    );
                  })}
                </div>
              );
          })}

          {activeSession?.activePlan && (
            <PlanViewer
              plan={activeSession.activePlan}
              onApprove={approvePlan}
              onReject={rejectPlan}
              theme={theme}
            />
          )}

          {activeSession && activeSession.suggestions.length > 0 && !activeSession.thinking && (
            <div className="flex gap-1.5 flex-wrap py-1">
              {activeSession.suggestions.map((s, i) => (
                <button
                  key={`suggestion-${String(i)}`}
                  onClick={() => sendMessage(s)}
                  className="px-3 py-1 rounded-full border border-blue text-blue bg-transparent text-[11px] cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {activeSession && shouldShowLivePill(activeSession as unknown as ChatSessionShape) && (
            <div data-testid="chat-live-pill" className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground text-[11px]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue animate-pulse" />
              <span>Thinking...</span>
            </div>
          )}

          {/* Intermediate "Working: <tool-name>" pill when a tool is running.
              Replaces the old free-floating progressText line that looked too much
              like a discrete thought. We derive the label from the latest running
              tool rather than from the model's intermediate text (which is
              captured in the next thought/response anyway). */}
          {activeSession?.thinking && activeSession.toolActivity.some((t) => t.status === "running") && (
            <div
              data-testid="chat-working-pill"
              className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              <span className="inline-block w-1 h-1 rounded-full bg-blue animate-pulse" />
              <span className="italic">
                Working: {activeSession.toolActivity.filter((t) => t.status === "running").map((t) => t.toolName).join(", ")}
              </span>
            </div>
          )}

          {/* Queued messages — floating cards for mid-loop injections */}
          {activeSession && activeSession.queuedMessages.length > 0 && (
            <div className="flex flex-col items-end gap-1.5 mt-1">
              {activeSession.queuedMessages.map((q, qi) => (
                <div
                  key={`queued-${String(qi)}-${q.timestamp}`}
                  data-testid="queued-card"
                  className="max-w-[75%] px-3 py-2 rounded-[10px] border-2 border-dashed border-blue/40 bg-background text-foreground text-[12px] leading-relaxed"
                >
                  <div className="text-[9px] text-blue/60 font-semibold mb-0.5">Queued</div>
                  <div className="line-clamp-3 whitespace-pre-wrap">{q.text}</div>
                  <div className="text-[9px] mt-0.5 text-right text-muted-foreground">
                    {new Date(q.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error !== null && (
            <div
              className="px-2.5 py-1.5 rounded-md bg-secondary text-red text-xs flex items-start justify-between gap-2"
              data-testid="chat-error"
            >
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none"
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Jump-to-bottom button — floats over the message list when the user
            is scrolled up. Shows an unread count when new messages arrived
            while detached. Clicking scrolls to bottom and re-pins. */}
        {!autoScroll && (
          <button
            type="button"
            onClick={scrollToBottom}
            className={cn(
              "absolute left-1/2 -translate-x-1/2 bottom-24 z-20",
              "flex items-center gap-2 px-3 py-1.5 rounded-full",
              "bg-primary text-primary-foreground text-[12px] font-medium",
              "shadow-lg hover:opacity-90 transition-opacity cursor-pointer",
            )}
          >
            {unreadCount > 0 ? (
              <>
                <span>{unreadCount} new</span>
                <span aria-hidden>↓</span>
              </>
            ) : (
              <>
                <span>Jump to bottom</span>
                <span aria-hidden>↓</span>
              </>
            )}
          </button>
        )}

        {/* Drawer system */}
        {activeSession && (
          <DrawerSystem
            activeDrawer={activeDrawer}
            onSetDrawer={setActiveDrawer}
            suggestions={activeSession.suggestions}
            onSendSuggestion={sendMessage}
            context={activeSession.context}
            selectedPlanId={selectedPlanId}
            onSelectPlan={(planId) => {
              setSelectedPlanId(planId);
              setActiveDrawer("plans");
            }}
          />
        )}

        {/* Attachment preview */}
        {activeSession && attachments.length > 0 && (
          <div className="px-3 py-1.5 border-t border-border bg-card flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto shrink-0">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-background border border-border text-[11px] text-foreground max-w-[200px]"
              >
                {att.type === "image" ? (
                  <img
                    src={att.content}
                    alt={att.name}
                    className="w-6 h-6 rounded object-cover"
                  />
                ) : (
                  <span className="text-sm shrink-0">&#128196;</span>
                )}
                <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                  {att.name}
                </span>
                <span className="text-muted-foreground text-[10px] shrink-0">
                  {formatFileSize(att.size)}
                </span>
                <span
                  onClick={() => removeAttachment(att.id)}
                  className="cursor-pointer text-red font-bold text-xs shrink-0"
                >
                  x
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Input bar */}
        {activeSession && (
          <div className="px-3 py-2.5 border-t border-border bg-card flex gap-1.5 items-end shrink-0">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            {/* Paperclip button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              className="p-2 rounded-[10px] border border-border bg-transparent text-muted-foreground text-base cursor-pointer shrink-0 leading-none"
            >
              &#128206;
            </button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Message Aionima..."
              rows={1}
              className="flex-1 text-[13px] resize-none min-h-[44px] max-h-[100px]"
            />
            {activeSession?.thinking ? (
              <button
                onClick={cancelInvocation}
                className="px-3.5 py-2 rounded-[10px] border-none text-[13px] font-semibold bg-red text-white cursor-pointer"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={() => sendMessage(input)}
                disabled={!canSend}
                className={cn(
                  "px-3.5 py-2 rounded-[10px] border-none text-[13px] font-semibold",
                  canSend
                    ? "bg-primary text-primary-foreground cursor-pointer"
                    : "bg-secondary text-muted-foreground cursor-default",
                )}
              >
                Send
              </button>
            )}
          </div>
        )}
    </div>
  );

  // s134 cycle 87 — Canvas surface state. Derives from selectedPlanId (user
  // picked a plan from the drawer) and latestIterationArtifact (most recent
  // iteration completion notification for this project's session). Plan
  // wins when both are set, since plans are direct user-driven openings.
  const canvasSurface: CanvasSurface = (() => {
    if (selectedPlanId !== null && activeSession !== null) {
      return { kind: "plan", planId: selectedPlanId, projectPath: activeSession.context };
    }
    if (latestIterationArtifact !== null) {
      return { kind: "iteration-artifact", notification: latestIterationArtifact };
    }
    return { kind: "empty" };
  })();

  const handleCanvasDismiss = () => {
    if (selectedPlanId !== null) setSelectedPlanId(null);
    // Iteration artifacts can't be "dismissed" — they fade naturally as
    // newer iterations arrive. Leaving the canvas empty would just feel
    // like a regression. So no-op on artifact dismiss for now.
  };

  // The chat slot — the existing panelHeader + panelBody composed into a
  // full-height flex column. AccordionFlyout positions it inside its chat
  // section.
  const chatSlot = (
    <div className="flex flex-col h-full min-w-0 w-full">
      {panelHeader}
      {panelBody}
    </div>
  );

  // The canvas slot — AgentCanvas dispatches by surface kind. Approve/reject
  // for plans route through the same WS events the inline PlanPane was using.
  const canvasSlot = (
    <AgentCanvas
      surface={canvasSurface}
      onDismiss={handleCanvasDismiss}
      onPlanApprove={(id) => {
        approvePlan(id);
        setSelectedPlanId(null);
      }}
      onPlanReject={(id) => {
        rejectPlan(id);
        setSelectedPlanId(null);
      }}
    />
  );

  // Docked mode: inline flex child (no overlay, no backdrop). The
  // AccordionFlyout owns the chat-vs-canvas split internally — this branch
  // just sizes the outer container.
  if (docked) {
    return (
      <>
        <div
          data-testid="chat-flyout"
          className="flex h-full border-l border-border bg-background"
          style={{ width: "50%" }}
        >
          <AccordionFlyout
            chat={chatSlot}
            canvas={canvasSlot}
            isMobile={isMobile}
          />
        </div>
        <TokenBreakdownModal
          open={tokenBreakdownMsg !== null}
          onClose={() => setTokenBreakdownMsg(null)}
          breakdown={tokenBreakdownMsg?.routingMeta?.tokenBreakdown}
          totalIn={tokenBreakdownMsg?.routingMeta?.inputTokens ?? 0}
          totalOut={tokenBreakdownMsg?.routingMeta?.outputTokens ?? 0}
        />
      </>
    );
  }

  // Overlay mode: fixed panel with backdrop. Sits at z-[200]; header
  // overlays (notifications/upgrade/dev-notes/settings) MUST use z-[300]+
  // per the cycle 87 z-index policy so the header stays clickable on top.
  // Sized to sit BELOW the app header: top-14 on desktop, top-12 on mobile;
  // the header itself stays sticky at top-0 z-[100].
  return (
    <>
      <div
        data-testid="chat-flyout"
        className="fixed inset-x-0 top-12 md:top-14 bottom-0 z-[200] flex justify-end pointer-events-none"
      >
        {!isFullscreen && (
          <div className={cn("bg-black/10", isMobile ? "absolute inset-0" : "flex-1")} />
        )}
        <div
          className={cn(
            "bg-background pointer-events-auto",
            isMobile
              ? "absolute bottom-0 left-0 right-0 h-[90dvh] border-t border-border rounded-t-2xl"
              : cn(
                  "h-full border-l border-border",
                  // Wider when canvas can be open (so it doesn't squish):
                  // fullscreen → 100vw, otherwise ~66vw to give canvas + chat
                  // each meaningful real estate (vs the old 33vw chat-only).
                  isFullscreen ? "w-screen" : "w-[min(66vw,1200px)] min-w-[640px] max-w-full",
                ),
          )}
        >
          <AccordionFlyout
            chat={chatSlot}
            canvas={canvasSlot}
            isMobile={isMobile}
          />
        </div>
      </div>
      <TokenBreakdownModal
        open={tokenBreakdownMsg !== null}
        onClose={() => setTokenBreakdownMsg(null)}
        breakdown={tokenBreakdownMsg?.routingMeta?.tokenBreakdown}
        totalIn={tokenBreakdownMsg?.routingMeta?.inputTokens ?? 0}
        totalOut={tokenBreakdownMsg?.routingMeta?.outputTokens ?? 0}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// DrawerSystem
// ---------------------------------------------------------------------------

interface DrawerSystemProps {
  activeDrawer: DrawerTab | null;
  onSetDrawer: (drawer: DrawerTab | null) => void;
  suggestions: string[];
  onSendSuggestion: (text: string) => void;
  context: string;
  selectedPlanId: string | null;
  onSelectPlan: (planId: string) => void;
}

const DRAWER_TABS: { key: DrawerTab; label: string }[] = [
  { key: "work-queue", label: "Work Queue" },
  { key: "project-info", label: "Project" },
  { key: "plans", label: "Plans" },
];

function DrawerSystem({ activeDrawer, onSetDrawer, onSendSuggestion, context, selectedPlanId, onSelectPlan }: DrawerSystemProps) {
  const [taskmasterJobs, setTaskmasterJobs] = useState<WorkerJobSummary[]>([]);
  const [taskmasterError, setTaskmasterError] = useState<string | null>(null);
  const [taskmasterLoading, setTaskmasterLoading] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);

  // Scope the Work Queue view to the chat's current project. In "general" mode
  // (no project context) the scoped arg is null and the endpoint falls back to
  // the global list.
  const scopedProjectPath = context === "general" ? null : context;

  const loadJobs = useCallback(async () => {
    try {
      const jobs = await fetchTaskmasterJobs(scopedProjectPath);
      setTaskmasterJobs(jobs);
      setTaskmasterError(null);
    } catch (err) {
      setTaskmasterError(err instanceof Error ? err.message : "Failed to load jobs");
    }
  }, [scopedProjectPath]);

  useEffect(() => {
    if (activeDrawer !== "work-queue") return;
    setTaskmasterLoading(true);
    void loadJobs().finally(() => setTaskmasterLoading(false));
    // Keep a low-frequency poll as a safety net in case the WS connection drops
    // between reconnects. Primary refresh driver is the WS subscription below.
    const interval = setInterval(() => { void loadJobs(); }, 30_000);
    return () => clearInterval(interval);
  }, [activeDrawer, loadJobs]);

  // Live Work Queue updates — refresh on any tm:job_update or tm:report_ready
  // frame from the dashboard broadcaster. Replaces the old 5s poll.
  useDashboardWS(
    useCallback((event) => {
      if (activeDrawer !== "work-queue") return;
      if (event.type === "tm:job_update" || event.type === "tm:report_ready") {
        void loadJobs();
      }
    }, [activeDrawer, loadJobs]),
  );

  const handleApprove = useCallback(async (jobId: string) => {
    setActionPending(jobId);
    try {
      await approveTaskmasterJob(jobId);
      await loadJobs();
    } catch (err) {
      setTaskmasterError(err instanceof Error ? err.message : "Failed to approve job");
    } finally {
      setActionPending(null);
    }
  }, [loadJobs]);

  const handleReject = useCallback(async (jobId: string) => {
    setActionPending(jobId);
    try {
      await rejectTaskmasterJob(jobId);
      await loadJobs();
    } catch (err) {
      setTaskmasterError(err instanceof Error ? err.message : "Failed to reject job");
    } finally {
      setActionPending(null);
    }
  }, [loadJobs]);

  function statusColorClass(status: WorkerJobSummary["status"]): string {
    if (status === "complete") return "text-green";
    if (status === "failed") return "text-red";
    if (status === "checkpoint") return "text-yellow";
    if (status === "running") return "text-blue";
    return "text-muted-foreground";
  }

  return (
    <div className="shrink-0">
      {/* Drawer tab row */}
      <div className="flex gap-0.5 px-3 py-1 border-t border-border bg-card overflow-x-auto">
        {DRAWER_TABS.filter((t) => {
          // "plans" + "project-info" require a project context. "work-queue"
          // is always available.
          if (t.key === "project-info" || t.key === "plans") return context !== "general";
          return true;
        }).map((t) => (
          <button
            key={t.key}
            onClick={() => onSetDrawer(activeDrawer === t.key ? null : t.key)}
            className={cn(
              "px-2.5 py-0.5 rounded-xl border text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0",
              activeDrawer === t.key
                ? "border-blue bg-secondary text-blue"
                : "border-border bg-transparent text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Drawer content */}
      {activeDrawer !== null && (
        <div className="px-3 py-2.5 bg-background border-t border-border max-h-[160px] overflow-y-auto">
          {activeDrawer === "work-queue" && (() => {
            // Drawer shows ONLY active work so it doesn't pile up with
            // completed rows. Full history lives in the project's Taskmaster
            // tab (ProjectDetail → TaskMaster) where all statuses are
            // filterable and completed jobs expand to reveal their summary.
            const activeJobs = taskmasterJobs.filter(
              (j) => j.status === "pending" || j.status === "running" || j.status === "checkpoint",
            );
            return (
            <div>
              {taskmasterLoading && activeJobs.length === 0 && (
                <span className="text-[11px] text-muted-foreground">Loading...</span>
              )}
              {taskmasterError !== null && (
                <span className="text-[11px] text-red">{taskmasterError}</span>
              )}
              {!taskmasterLoading && activeJobs.length === 0 && taskmasterError === null && (
                <span className="text-[11px] text-muted-foreground">No active work — history is in the project's Taskmaster tab.</span>
              )}
              {activeJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-start gap-2 py-1.5 border-b border-border text-[11px]"
                >
                  <span className={cn(
                    "font-semibold shrink-0 uppercase text-[9px] pt-px",
                    statusColorClass(job.status),
                  )}>
                    {job.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                      {job.description}
                    </div>
                    {job.currentPhase !== null && (
                      <div className="text-muted-foreground text-[10px]">
                        {job.currentPhase}
                        {job.workers.length > 0 && ` — ${job.workers.join(", ")}`}
                      </div>
                    )}
                  </div>
                  {job.status === "checkpoint" && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => { void handleApprove(job.id); }}
                        disabled={actionPending === job.id}
                        className="px-2 py-0.5 rounded-md border border-green bg-transparent text-green text-[10px] cursor-pointer disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => { void handleReject(job.id); }}
                        disabled={actionPending === job.id}
                        className="px-2 py-0.5 rounded-md border border-red bg-transparent text-red text-[10px] cursor-pointer disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            );
          })()}

          {activeDrawer === "project-info" && context !== "general" && (
            <div>
              <div className="text-[11px] text-muted-foreground mb-2">
                <span className="font-mono text-foreground">{context.split("/").pop()}</span>
                <span className="ml-1.5 opacity-70">{context}</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {["Explain this project", "Open tasks?", "Recent changes", "Help debug"].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => onSendSuggestion(prompt)}
                    className="px-2.5 py-1 rounded-lg border border-border bg-secondary text-foreground text-[11px] cursor-pointer"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeDrawer === "plans" && context !== "general" && (
            <PlansDrawer
              projectPath={context}
              selectedPlanId={selectedPlanId}
              onSelect={onSelectPlan}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentBubble — assistant message bubble with a floating copy button.
//
// Click:          copy styled (text/html + text/plain fallback), so pasting
//                 into a rich-text target (Notion, Word, GitHub issue editor)
//                 keeps code blocks, formatting, and custom-tag styling.
// Ctrl/Cmd+Click: copy raw markdown source (the msg.content string as-is).
//
// The button sits above the bubble at the top-right — opposite the Aion label
// at the top-left — and transitions to a checkmark for ~1.2s after a copy
// lands so the user gets feedback without a toast.
// ---------------------------------------------------------------------------
function AgentBubble({ content }: { content: string }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    const raw = e.ctrlKey || e.metaKey;
    try {
      if (raw) {
        await navigator.clipboard.writeText(content);
      } else {
        const html = contentRef.current?.innerHTML ?? "";
        const plain = contentRef.current?.innerText ?? content;
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
          const item = new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          });
          await navigator.clipboard.write([item]);
        } else {
          // Older browser fallback — plain text only.
          await navigator.clipboard.writeText(plain);
        }
      }
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard permission denied or navigator.clipboard unavailable —
      // silently no-op. No fallback to document.execCommand("copy") because
      // the raw content could be large and synchronous DOM selection is
      // jarring; the user can re-click.
    }
  }, [content]);

  return (
    <div className="relative max-w-[80%]">
      <button
        type="button"
        onClick={handleCopy}
        title="Copy styled · Ctrl/Cmd+Click for raw markdown"
        aria-label="Copy message"
        className={cn(
          "absolute -top-2 right-2 z-10",
          "w-6 h-6 rounded-md flex items-center justify-center",
          "bg-card border border-border text-muted-foreground",
          "hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer",
          "shadow-sm",
        )}
      >
        {copied ? <CheckIcon className="w-3.5 h-3.5 text-green" /> : <CopyIcon className="w-3.5 h-3.5" />}
      </button>
      <div
        ref={contentRef}
        className="px-3 py-2 rounded-[10px] text-[13px] leading-relaxed break-words bg-card text-card-foreground border border-border"
      >
        <ContentRenderer value={content} format="markdown" />
      </div>
    </div>
  );
}
