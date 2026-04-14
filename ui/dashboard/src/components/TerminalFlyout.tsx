/**
 * TerminalFlyout — Bottom flyout panel with per-project terminal tabs.
 *
 * Uses xterm.js for terminal rendering and WebSocket for I/O.
 * Follows the ChatFlyout pattern (own WS connection, fixed overlay).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ProjectInfo } from "../types.js";
import { useIsMobile } from "@/hooks.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TerminalTab {
  id: string; // WS session ID (from terminal:opened)
  projectPath: string;
  projectLabel: string;
  terminal: Terminal;
  fitAddon: FitAddon;
}

export interface TerminalFlyoutProps {
  open: boolean;
  onClose: () => void;
  initialProjectPath: string | null;
  projects: ProjectInfo[];
}

// ---------------------------------------------------------------------------
// Theme — Catppuccin Mocha terminal colors
// ---------------------------------------------------------------------------

const TERM_THEME = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  cursorAccent: "#1e1e2e",
  selectionBackground: "#585b70",
  selectionForeground: "#cdd6f4",
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#94e2d5",
  white: "#bac2de",
  brightBlack: "#585b70",
  brightRed: "#f38ba8",
  brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#f5c2e7",
  brightCyan: "#94e2d5",
  brightWhite: "#a6adc8",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TerminalFlyout({ open, onClose, initialProjectPath, projects }: TerminalFlyoutProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isMobile = useIsMobile();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingOpenRef = useRef<string | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // -------------------------------------------------------------------------
  // WS connection
  // -------------------------------------------------------------------------

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Flush pending open. Empty string sentinel means system-mode (no projectPath).
      if (pendingOpenRef.current !== null) {
        const path = pendingOpenRef.current;
        pendingOpenRef.current = null;
        const payload: Record<string, unknown> = { cols: 120, rows: 30 };
        if (path) payload.projectPath = path;
        ws.send(JSON.stringify({ type: "terminal:open", payload }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; payload?: Record<string, unknown> };

        if (msg.type === "terminal:opened") {
          const { sessionId, projectPath, scope } = msg.payload as { sessionId: string; projectPath: string; scope?: string };
          const label = scope === "system"
            ? "System"
            : (projectsRef.current.find((p) => p.path === projectPath)?.name ?? projectPath.split("/").pop() ?? "Terminal");

          const term = new Terminal({
            theme: TERM_THEME,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontSize: 13,
            cursorBlink: true,
          });
          const fitAddon = new FitAddon();
          const webLinksAddon = new WebLinksAddon();
          term.loadAddon(fitAddon);
          term.loadAddon(webLinksAddon);

          // Forward input to backend
          term.onData((data) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "terminal:input", payload: { sessionId, data } }));
            }
          });

          const tab: TerminalTab = { id: sessionId, projectPath, projectLabel: label, terminal: term, fitAddon };
          setTabs((prev) => [...prev, tab]);
          setActiveTabId(sessionId);
        }

        if (msg.type === "terminal:data") {
          const { sessionId, data } = msg.payload as { sessionId: string; data: string };
          const tab = tabsRef.current.find((t) => t.id === sessionId);
          tab?.terminal.write(data);
        }

        if (msg.type === "terminal:exited") {
          const { sessionId, code } = msg.payload as { sessionId: string; code: number | null };
          const tab = tabsRef.current.find((t) => t.id === sessionId);
          if (tab) {
            tab.terminal.write(`\r\n\x1b[90m[Process exited with code ${String(code ?? "unknown")}]\x1b[0m\r\n`);
          }
        }
      } catch { /* ignore non-JSON or unrelated messages */ }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        reconnectTimer.current = setTimeout(() => {
          if (wsRef.current === ws || wsRef.current === null) connect();
        }, 3000);
      }
    };

    ws.onerror = () => { /* onclose fires after onerror */ };
  }, []);

  // Connect when open
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
  // Open terminal for a project
  // -------------------------------------------------------------------------

  const openTerminal = useCallback((projectPath: string | null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Empty string is the sentinel for "system terminal" in the pending queue.
      pendingOpenRef.current = projectPath ?? "";
      return;
    }
    // Omit projectPath entirely for system-mode — server opens in $HOME.
    const payload: Record<string, unknown> = { cols: 120, rows: 30 };
    if (projectPath) payload.projectPath = projectPath;
    ws.send(JSON.stringify({ type: "terminal:open", payload }));
    setPickerOpen(false);
  }, []);

  // Handle initialProjectPath changes
  useEffect(() => {
    if (!open) return;
    // System-terminal mode: initialProjectPath is null and no tabs yet.
    if (!initialProjectPath) {
      if (tabs.length === 0) openTerminal(null);
      return;
    }
    // Project-scoped mode: reuse existing tab for the same project when possible.
    const existing = tabs.find((t) => t.projectPath === initialProjectPath);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    openTerminal(initialProjectPath);
  }, [open, initialProjectPath, tabs, openTerminal]);

  // -------------------------------------------------------------------------
  // Close tab
  // -------------------------------------------------------------------------

  const closeTab = useCallback((sessionId: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal:close", payload: { sessionId } }));
    }
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === sessionId);
      if (tab) {
        tab.terminal.dispose();
      }
      return prev.filter((t) => t.id !== sessionId);
    });
    setActiveTabId((prev) => {
      if (prev !== sessionId) return prev;
      const remaining = tabsRef.current.filter((t) => t.id !== sessionId);
      return remaining.length > 0 ? remaining[remaining.length - 1]!.id : null;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Attach terminal to DOM
  // -------------------------------------------------------------------------

  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    if (!activeTab || !containerRef.current) return;
    const el = containerRef.current;

    // Clear previous
    el.innerHTML = "";
    activeTab.terminal.open(el);

    // Fit after mount
    requestAnimationFrame(() => {
      try { activeTab.fitAddon.fit(); } catch { /* container might not be visible yet */ }
    });

    activeTab.terminal.focus();
  }, [activeTab]);

  // Refit on expand/collapse
  useEffect(() => {
    if (!activeTab) return;
    const timer = setTimeout(() => {
      try { activeTab.fitAddon.fit(); } catch { /* */ }
    }, 100);
    return () => clearTimeout(timer);
  }, [expanded, activeTab]);

  // ResizeObserver for auto-fit
  useEffect(() => {
    if (!containerRef.current || !activeTab) return;
    const observer = new ResizeObserver(() => {
      try {
        activeTab.fitAddon.fit();
        // Notify backend of new dimensions
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "terminal:resize",
            payload: { sessionId: activeTab.id, cols: activeTab.terminal.cols, rows: activeTab.terminal.rows },
          }));
        }
      } catch { /* */ }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [activeTab]);

  // -------------------------------------------------------------------------
  // Cleanup on unmount / close
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (open) return;
    // Dispose all terminals and close sessions when flyout closes
    for (const tab of tabsRef.current) {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal:close", payload: { sessionId: tab.id } }));
      }
      tab.terminal.dispose();
    }
    setTabs([]);
    setActiveTabId(null);
    setExpanded(false);
  }, [open]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 right-0 z-[180] transition-[height] duration-200",
        isMobile ? "left-0" : "left-[var(--sidebar-width,240px)]",
      )}
      style={{ height: isMobile ? (expanded ? "90dvh" : "60dvh") : (expanded ? "80vh" : "40vh") }}
    >
      <div className="flex flex-col h-full bg-[#1e1e2e] border-t border-border">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#181825] border-b border-border shrink-0">
          <span className="text-[12px] font-semibold text-[#cdd6f4]">Terminal</span>

          {/* Tab bar */}
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto ml-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors",
                  tab.id === activeTabId
                    ? "bg-[#313244] text-[#cdd6f4]"
                    : "text-[#6c7086] hover:text-[#a6adc8] hover:bg-[#313244]/50",
                )}
              >
                <span>{tab.projectLabel}</span>
                <span
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className="ml-0.5 hover:text-[#f38ba8] cursor-pointer"
                >
                  x
                </span>
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0 relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-[#a6adc8] hover:text-[#cdd6f4]"
              onClick={() => setPickerOpen((p) => !p)}
            >
              +
            </Button>

            {/* Project picker dropdown */}
            {pickerOpen && (
              <div className="absolute top-full right-0 mt-1 w-56 bg-[#313244] border border-[#45475a] rounded-lg shadow-lg z-[200] max-h-[200px] overflow-y-auto">
                {projects.map((p) => (
                  <button
                    key={p.path}
                    onClick={() => openTerminal(p.path)}
                    className="block w-full text-left px-3 py-1.5 text-[11px] text-[#cdd6f4] hover:bg-[#45475a] transition-colors"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-[#a6adc8] hover:text-[#cdd6f4]"
              onClick={() => setExpanded((p) => !p)}
            >
              {expanded ? "Shrink" : "Expand"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-[#a6adc8] hover:text-[#f38ba8]"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>

        {/* Terminal area */}
        <div className="flex-1 min-h-0">
          {tabs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[12px] text-[#6c7086]">
              No terminal sessions. Click + to open one.
            </div>
          ) : (
            <div ref={containerRef} className="h-full w-full" />
          )}
        </div>
      </div>
    </div>
  );
}
