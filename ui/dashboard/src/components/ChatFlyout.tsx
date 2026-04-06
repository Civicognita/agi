/**
 * ChatFlyout — Right-side slide-in chat panel with multi-session tabs and drawers.
 *
 * Replaces the old full-page Chat view. Supports multiple concurrent chat sessions,
 * project/general context per tab, and a collapsible drawer system with Quick Replies.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/lib/markdown.js";
import type { WorkerJobSummary, Plan, PlanStatus, PlanStep, ProjectInfo } from "../types.js";
import { approveBotsJob, fetchBotsJobs, rejectBotsJob } from "../api.js";
import { ToolCards, LiveToolCards, SingleToolCard } from "./ToolCards.js";
import type { ToolCard } from "./ToolCards.js";
import { PlanViewer } from "./PlanViewer.js";
import { ChatHistory } from "./ChatHistory.js";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks.js";

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

type DrawerTab = "work-queue" | "project-info";

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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatFlyout({ open, onClose, theme = "dark", projects, openWithContext, openWithMessage, openRequestId, docked = false }: ChatFlyoutProps) {
  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<DrawerTab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const isMobile = useIsMobile();

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
  // WebSocket connection
  // -------------------------------------------------------------------------

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Flush any pending openWithContext that arrived before WS was ready
      const pending = pendingContextRef.current;
      if (pending) {
        pendingContextRef.current = null;
        ws.send(JSON.stringify({ type: "chat:open", payload: { context: pending } }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; payload?: unknown };
        const payload = msg.payload as Record<string, unknown> | undefined;
        const sid = payload?.sessionId as string | undefined;

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
              return [...prev, {
                id: p.sessionId,
                context: p.context,
                contextLabel,
                messages: p.messages ?? [],
                thinking: false,
                pendingMessages: 0,
                suggestions: [],
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
            const p = payload as { sessionId?: string; runId?: string; text: string; timestamp: string };
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
                messages: [...s.messages, ...queuedAsMsgs, { role: "assistant" as const, content: p.text, timestamp: p.timestamp, runId: p.runId ?? s.activeRunId }],
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
          case "chat:plan_created": {
            const p = payload as { sessionId: string; plan: Plan };
            if (!p.sessionId) break;
            setSessions((prev) => prev.map((s) =>
              s.id === p.sessionId ? { ...s, activePlan: p.plan } : s
            ));
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
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

  // Auto-scroll
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, []);

  useEffect(() => {
    if (autoScroll) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
  // Markdown rendering components (shared module, chat-size variant)
  // -------------------------------------------------------------------------

  const mdComponents = useMemo(() => markdownComponents({
    onQuestionSubmit: (answers) => {
      // Send answered questions as a formatted message
      const lines = Object.entries(answers)
        .filter(([, v]) => v.trim().length > 0)
        .map(([k, v]) => `**${k}:** ${v}`);
      if (lines.length > 0) {
        sendMessage(lines.join("\n"));
      }
    },
  }), [sendMessage]);

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

          {activeSession && activeSession.messages.map((msg, idx) => {
            // Tool messages — standalone card with label
            if (msg.role === "tool" && msg.toolCard) {
              return (
                <div key={`tool-${msg.toolCard.id}-${String(idx)}`} className="flex flex-col items-start gap-1">
                  <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider px-1">
                    Tool: {msg.toolCard.toolName}
                  </div>
                  <div className="max-w-[85%]">
                    <SingleToolCard card={msg.toolCard} collapsed />
                  </div>
                </div>
              );
            }

            // Thought messages — shown as a distinct message bubble (not collapsed)
            if (msg.role === "thought") {
              return (
                <div key={`thought-${msg.timestamp}-${String(idx)}`} className="flex flex-col items-start gap-1">
                  <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider px-1">
                    Thinking
                    <span className="ml-2 font-normal opacity-60">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="max-w-[85%] px-3 py-2 rounded-[10px] bg-secondary/60 border border-border text-muted-foreground text-[12px] leading-relaxed whitespace-pre-wrap">
                    {msg.content.length > 500 ? (
                      <details>
                        <summary className="cursor-pointer select-none">
                          {msg.content.slice(0, 200)}...
                        </summary>
                        <div className="mt-1">{msg.content}</div>
                      </details>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              );
            }

            // User and assistant messages
            const isUser = msg.role === "user";
            return (
              <div key={`${msg.timestamp}-${String(idx)}`} className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
                {/* Role label */}
                <div className={cn("text-[9px] font-semibold uppercase tracking-wider px-1", isUser ? "text-primary/60" : "text-muted-foreground")}>
                  {isUser ? "You" : "Aionima"}
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
                <div className={cn(
                  "max-w-[80%] px-3 py-2 rounded-[10px] text-[13px] leading-relaxed break-words",
                  isUser
                    ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                    : "bg-card text-card-foreground border border-border",
                )}>
                  {isUser ? (
                    <>
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
                    </>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {msg.content}
                    </ReactMarkdown>
                  )}
                </div>
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

          {activeSession?.thinking && (
            <div className="flex justify-start flex-col gap-0.5 max-w-[85%]">
              <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground text-[11px]">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue animate-pulse" />
                <span>{activeSession.toolActivity.some((t) => t.status === "running") ? "Working..." : "Thinking..."}</span>
              </div>
              {activeSession.progressText && (
                <div className="px-2 py-1 text-[11px] text-muted-foreground italic truncate">
                  {activeSession.progressText}
                </div>
              )}
            </div>
          )}

          {/* Queued messages — floating cards for mid-loop injections */}
          {activeSession && activeSession.queuedMessages.length > 0 && (
            <div className="flex flex-col items-end gap-1.5 mt-1">
              {activeSession.queuedMessages.map((q, qi) => (
                <div
                  key={`queued-${String(qi)}-${q.timestamp}`}
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
            <div className="px-2.5 py-1.5 rounded-md bg-secondary text-red text-xs">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Drawer system */}
        {activeSession && (
          <DrawerSystem
            activeDrawer={activeDrawer}
            onSetDrawer={setActiveDrawer}
            suggestions={activeSession.suggestions}
            onSendSuggestion={sendMessage}
            context={activeSession.context}
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
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Message Aionima..."
              rows={1}
              className="flex-1 px-3 py-2 rounded-[10px] border border-border bg-background text-foreground text-[13px] font-[inherit] resize-none outline-none min-h-[44px] max-h-[100px]"
            />
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
          </div>
        )}
    </div>
  );

  // Docked mode: render as inline flex child (no overlay, no backdrop)
  if (docked) {
    return (
      <div className="flex flex-col h-full border-l border-border bg-background" style={{ width: "50%" }}>
        {panelHeader}
        {panelBody}
      </div>
    );
  }

  // Overlay mode: fixed panel with backdrop
  return (
    <div className="fixed inset-0 z-[200] flex justify-end">
      {!isFullscreen && (
        <div className={cn("bg-black/30", isMobile ? "absolute inset-0" : "flex-1")} onClick={onClose} />
      )}
      <div className={cn(
        "flex flex-col bg-background",
        isMobile
          ? "fixed bottom-0 left-0 right-0 h-[90dvh] border-t border-border rounded-t-2xl"
          : cn("h-screen", isFullscreen ? "w-screen" : "w-[33vw] max-w-full border-l border-border"),
      )}>
        {panelHeader}
        {panelBody}
      </div>
    </div>
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
}

const DRAWER_TABS: { key: DrawerTab; label: string }[] = [
  { key: "work-queue", label: "Work Queue" },
  { key: "project-info", label: "Project" },
];

function DrawerSystem({ activeDrawer, onSetDrawer, onSendSuggestion, context }: DrawerSystemProps) {
  const [botsJobs, setBotsJobs] = useState<WorkerJobSummary[]>([]);
  const [botsError, setBotsError] = useState<string | null>(null);
  const [botsLoading, setBotsLoading] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const jobs = await fetchBotsJobs();
      setBotsJobs(jobs);
      setBotsError(null);
    } catch (err) {
      setBotsError(err instanceof Error ? err.message : "Failed to load jobs");
    }
  }, []);

  useEffect(() => {
    if (activeDrawer !== "work-queue") return;
    setBotsLoading(true);
    void loadJobs().finally(() => setBotsLoading(false));
    const interval = setInterval(() => { void loadJobs(); }, 5000);
    return () => clearInterval(interval);
  }, [activeDrawer, loadJobs]);

  const handleApprove = useCallback(async (jobId: string) => {
    setActionPending(jobId);
    try {
      await approveBotsJob(jobId);
      await loadJobs();
    } catch (err) {
      setBotsError(err instanceof Error ? err.message : "Failed to approve job");
    } finally {
      setActionPending(null);
    }
  }, [loadJobs]);

  const handleReject = useCallback(async (jobId: string) => {
    setActionPending(jobId);
    try {
      await rejectBotsJob(jobId);
      await loadJobs();
    } catch (err) {
      setBotsError(err instanceof Error ? err.message : "Failed to reject job");
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
        {DRAWER_TABS.filter((t) => t.key !== "project-info" || context !== "general").map((t) => (
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
          {activeDrawer === "work-queue" && (
            <div>
              {botsLoading && botsJobs.length === 0 && (
                <span className="text-[11px] text-muted-foreground">Loading...</span>
              )}
              {botsError !== null && (
                <span className="text-[11px] text-red">{botsError}</span>
              )}
              {!botsLoading && botsJobs.length === 0 && botsError === null && (
                <span className="text-[11px] text-muted-foreground">No active work</span>
              )}
              {botsJobs.map((job) => (
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
          )}

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
        </div>
      )}
    </div>
  );
}
