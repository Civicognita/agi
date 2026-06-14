/**
 * HearthHome — calm overview page for the "/" route.
 *
 * Centered chat column (greeting + suggestion chips + quick-send input)
 * with a right "Needs you / Today" drawer.
 *
 * s197 — Hearth Home.
 */

import { useState } from "react";
import { Send } from "lucide-react";
import { NeedsYouDrawer } from "@/components/NeedsYouDrawer.js";
import { useRootContext } from "@/routes/root.js";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

const SUGGESTION_CHIPS = [
  "What's on this week?",
  "Aionima status",
  "Review security scan",
];

export function HearthHome() {
  const { configHook, projectActivity, onOpenChatWithMessage } = useRootContext();
  const name = (configHook.data as { owner?: { displayName?: string } } | undefined)?.owner?.displayName ?? "there";
  const [draft, setDraft] = useState("");

  const sendMessage = (msg: string) => {
    const m = msg.trim();
    if (!m) return;
    onOpenChatWithMessage("home", m);
    setDraft("");
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden" data-testid="hearth-home">
      {/* Chat column */}
      <div className="flex-1 flex flex-col items-center justify-center min-w-0 px-6 py-8 gap-6">
        {/* Greeting */}
        <div className="text-center max-w-lg">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="hearth-greeting">
            {getGreeting()}, {name}.
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Everything's calm — Aion is ready.
          </p>
        </div>

        {/* Suggestion chips */}
        <div className="flex flex-wrap gap-2 justify-center" data-testid="hearth-suggestion-chips">
          {SUGGESTION_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => sendMessage(chip)}
              className="px-3 py-1.5 rounded-full border border-border bg-card text-[12px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Quick-send input */}
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 focus-within:border-primary transition-colors">
            <input
              type="text"
              placeholder="Ask Aion anything…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage(draft)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              data-testid="hearth-composer-input"
            />
            <button
              onClick={() => sendMessage(draft)}
              disabled={!draft.trim()}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              aria-label="Send"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Needs You / Today drawer */}
      <NeedsYouDrawer projectActivity={projectActivity} />
    </div>
  );
}
