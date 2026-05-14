/**
 * Chat — Conversational UI for direct interaction with Aionima.
 *
 * Uses WebSocket (chat:send / chat:response) to communicate with the agent
 * pipeline. Shares the owner's session across all channels.
 *
 * Cycle 226 (2026-05-14): composer swapped from hand-rolled textarea+button
 * to @particle-academy/react-fancy `PromptInput`. Brings slash-command +
 * @-mention pickers, drop-to-attach, token-budget meter, and Cmd/Ctrl+Enter
 * for free. Per CLAUDE.md § 1.5 — audit PAx first; the textarea was the
 * last hand-rolled chat composer in the dashboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PromptInput } from "@particle-academy/react-fancy";
import type { ChatMessage } from "../hooks.js";
import { LoopProgressBar } from "./LoopProgressBar.js";

export interface ChatProps {
  messages: ChatMessage[];
  thinking: boolean;
  error: string | null;
  onSend: (text: string) => void;
  theme: "light" | "dark";
}

export function Chat({ messages, thinking, error, onSend, theme }: ChatProps) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Track scroll position for auto-scroll lock
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, thinking, autoScroll]);

  // PromptInput owns its own composer state. We just gate the send on
  // `thinking` and drop attachments for now — CHN-B (s163) will wire
  // attachment forwarding into the chat backend once the SDK lands.
  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || thinking) return;
      onSend(trimmed);
    },
    [thinking, onSend],
  );

  // Bubble colors — kept as inline styles because the message bubbles
  // pre-date the PAx primitives. Slated for a follow-up swap to Callout
  // or Card once a chat-bubble primitive lands upstream.
  const d = theme === "dark";
  const surface0 = d ? "#313244" : "#e6e9ef";
  const border = d ? "#313244" : "#e6e9ef";
  const text = d ? "#cdd6f4" : "#4c4f69";
  const subtext = d ? "#a6adc8" : "#6c6f85";
  const userBubble = d ? "#89b4fa" : "#1e66f5";
  const userText = d ? "#1e1e2e" : "#ffffff";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Loop progress bar (s120) — mirror of terminal statusline */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border, #333)" }}>
        <LoopProgressBar />
      </div>
      {/* Message list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {messages.length === 0 && !thinking && (
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: subtext,
            fontSize: "15px",
          }}>
            Start a conversation with Aionima
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={`${msg.timestamp}-${String(i)}`}
              style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "70%",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  background: isUser ? userBubble : surface0,
                  color: isUser ? userText : text,
                  fontSize: "14px",
                  lineHeight: "1.5",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {msg.content}
                <div style={{ fontSize: "10px", color: isUser ? (d ? "rgba(30,30,46,0.5)" : "rgba(255,255,255,0.6)") : subtext, marginTop: "4px", textAlign: "right" }}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}

        {thinking && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{
              padding: "10px 14px",
              borderRadius: "12px",
              background: surface0,
              color: subtext,
              fontSize: "14px",
            }}>
              <ThinkingDots />
            </div>
          </div>
        )}

        {error !== null && (
          <div style={{
            padding: "8px 12px",
            borderRadius: "8px",
            background: d ? "#45475a" : "#fee2e2",
            color: d ? "#f38ba8" : "#d20f39",
            fontSize: "13px",
          }}>
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* PromptInput from @particle-academy/react-fancy — replaces the
          hand-rolled textarea+button. Slash commands, @-mentions, file
          drop-to-attach, and the token-budget meter come built-in.
          budgetTokens is a placeholder until the Provider router exposes
          the active model's context window via dashboard hooks. */}
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${border}` }}>
        <PromptInput
          budgetTokens={32_000}
          placeholder="Message Aionima…"
          showHint
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}

// Animated thinking dots
function ThinkingDots() {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => setDots((d) => (d % 3) + 1), 400);
    return () => clearInterval(interval);
  }, []);

  return <span>{".".repeat(dots)}</span>;
}
