/**
 * Chat — Conversational UI for direct interaction with Aionima.
 *
 * Uses WebSocket (chat:send / chat:response) to communicate with the agent
 * pipeline. Shares the owner's session across all channels.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../hooks.js";

export interface ChatProps {
  messages: ChatMessage[];
  thinking: boolean;
  error: string | null;
  onSend: (text: string) => void;
  theme: "light" | "dark";
}

export function Chat({ messages, thinking, error, onSend, theme }: ChatProps) {
  const [input, setInput] = useState("");
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

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || thinking) return;
    onSend(text);
    setInput("");
  }, [input, thinking, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Colors — use CSS variables to follow Catppuccin theme
  const d = theme === "dark";
  const surface = d ? "#1e1e2e" : "#ffffff";
  const surface0 = d ? "#313244" : "#e6e9ef";
  const border = d ? "#313244" : "#e6e9ef";
  const text = d ? "#cdd6f4" : "#4c4f69";
  const subtext = d ? "#a6adc8" : "#6c6f85";
  const userBubble = d ? "#89b4fa" : "#1e66f5";
  const userText = d ? "#1e1e2e" : "#ffffff";
  const inputBg = d ? "#181825" : "#f5f5f5";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
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

      {/* Input bar */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: `1px solid ${border}`,
          background: surface,
          display: "flex",
          gap: "8px",
          alignItems: "flex-end",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Aionima..."
          rows={1}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: "12px",
            border: `1px solid ${border}`,
            background: inputBg,
            color: text,
            fontSize: "14px",
            fontFamily: "inherit",
            resize: "none",
            outline: "none",
            minHeight: "40px",
            maxHeight: "120px",
          }}
        />
        <button
          onClick={handleSend}
          disabled={thinking || input.trim().length === 0}
          style={{
            padding: "10px 18px",
            borderRadius: "12px",
            border: "none",
            background: thinking || input.trim().length === 0 ? surface0 : userBubble,
            color: thinking || input.trim().length === 0 ? subtext : userText,
            fontSize: "14px",
            fontWeight: 600,
            cursor: thinking || input.trim().length === 0 ? "default" : "pointer",
          }}
        >
          Send
        </button>
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
