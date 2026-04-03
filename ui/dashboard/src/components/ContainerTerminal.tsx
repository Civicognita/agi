/**
 * ContainerTerminal — inline xterm.js shell inside a project's container.
 *
 * Connects to the existing WS at /ws using container-terminal:* messages.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// Catppuccin Mocha terminal colors (same as TerminalFlyout)
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

export interface ContainerTerminalProps {
  projectPath: string;
}

export function ContainerTerminal({ projectPath }: ContainerTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    if (sessionIdRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "container-terminal:close",
        payload: { sessionId: sessionIdRef.current },
      }));
    }
    termRef.current?.dispose();
    termRef.current = null;
    fitRef.current = null;
    sessionIdRef.current = null;
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: TERM_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Connect WS
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "container-terminal:open",
        payload: { projectPath, cols: term.cols, rows: term.rows },
      }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; payload?: Record<string, unknown> };
        switch (msg.type) {
          case "container-terminal:opened":
            sessionIdRef.current = msg.payload?.sessionId as string;
            setConnected(true);
            setError(null);
            break;
          case "container-terminal:data":
            if (msg.payload?.sessionId === sessionIdRef.current) {
              term.write(msg.payload.data as string);
            }
            break;
          case "container-terminal:exited":
            if (msg.payload?.sessionId === sessionIdRef.current) {
              term.write("\r\n[Session ended]\r\n");
              setConnected(false);
            }
            break;
          case "container-terminal:error":
            setError(msg.payload?.error as string ?? "Unknown error");
            break;
        }
      } catch { /* ignore non-JSON */ }
    };

    ws.onerror = () => setError("WebSocket error");
    ws.onclose = () => setConnected(false);

    // Input
    term.onData((data) => {
      if (sessionIdRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "container-terminal:input",
          payload: { sessionId: sessionIdRef.current, data },
        }));
      }
    });

    // Resize observer
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (sessionIdRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "container-terminal:resize",
          payload: { sessionId: sessionIdRef.current, cols: term.cols, rows: term.rows },
        }));
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      cleanup();
      ws.close();
    };
  }, [projectPath, cleanup]);

  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="text-xs text-red px-2 py-1 bg-red/10">{error}</div>
      )}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ minHeight: "120px" }}
      />
      {!connected && !error && (
        <div className="text-xs text-muted-foreground px-2 py-1">Connecting...</div>
      )}
    </div>
  );
}
