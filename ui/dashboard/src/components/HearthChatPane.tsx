/**
 * HearthChatPane — left column in focused canvas layout (s198).
 *
 * 38% width pane: back → home, context title/sub, placeholder thread,
 * and a quick-send composer that opens the chat flyout.
 *
 * Chat history streaming is stubbed for s198; real thread content
 * will arrive in a follow-on slice once the per-context chat API
 * surface is confirmed.
 *
 * s198 — Focused canvas state.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, Send } from "lucide-react";

interface HearthChatPaneProps {
  contextTitle: string;
  contextSub: string;
  onSendMessage: (msg: string) => void;
}

export function HearthChatPane({ contextTitle, contextSub, onSendMessage }: HearthChatPaneProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");

  const send = (msg: string) => {
    const m = msg.trim();
    if (!m) return;
    onSendMessage(m);
    setDraft("");
  };

  return (
    <div
      className="flex flex-col border-r border-border min-h-0"
      data-testid="hearth-chat-pane"
    >
      {/* Header */}
      <div className="flex items-center gap-2 h-12 px-3 border-b border-border shrink-0">
        <button
          onClick={() => void navigate("/")}
          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to home"
          data-testid="hearth-back-button"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-semibold truncate leading-tight"
            data-testid="hearth-context-title"
          >
            {contextTitle}
          </div>
          {contextSub && (
            <div className="text-[10px] text-muted-foreground truncate leading-tight">
              {contextSub}
            </div>
          )}
        </div>
      </div>

      {/* Thread area (stub — chat history in follow-on slice) */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="text-[11px] text-muted-foreground text-center mt-8">
          Chat history for this context appears here.
        </p>
      </div>

      {/* Composer */}
      <div className="px-3 py-3 border-t border-border shrink-0">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-primary transition-colors">
          <input
            type="text"
            placeholder="Reply, or ask Aion to change something…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(draft)}
            className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
            data-testid="hearth-pane-composer"
          />
          <button
            onClick={() => send(draft)}
            disabled={!draft.trim()}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            aria-label="Send"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
