/**
 * ZeroMeStep — Embedded chat UI for 0ME profile capture (MIND / SOUL / SKILL).
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { LemonadeBanner } from "@/components/LemonadeBanner.js";

interface Props {
  domain: "MIND" | "SOUL" | "SKILL";
  onNext: () => void;
  onSkip: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const DOMAIN_LABELS: Record<"MIND" | "SOUL" | "SKILL", string> = {
  MIND: "Intellectual Interests",
  SOUL: "Purpose & Values",
  SKILL: "Skills & Expertise",
};

const DOMAIN_COPY: Record<"MIND" | "SOUL" | "SKILL", { headline: string; subtitle: string }> = {
  MIND: {
    headline: "What lights up your mind?",
    subtitle: "Let's explore what fascinates you — the ideas that keep you up at night, the rabbit holes you love falling into. Aionima needs to understand how you think so it can think alongside you.",
  },
  SOUL: {
    headline: "What drives you forward?",
    subtitle: "Every action in Impactivism starts with purpose. Tell Aionima about the values that guide your decisions, the change you want to see, and the kind of impact you refuse to leave unmade.",
  },
  SKILL: {
    headline: "What can you build?",
    subtitle: "Impact requires capability. Share the tools you wield, the domains you've mastered, and the craft that makes you uniquely powerful — so Aionima knows what you're capable of when the moment comes.",
  },
};

const COMPLETION_MARKER = "[0ME_COMPLETE]";

export function ZeroMeStep({ domain, onNext, onSkip }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [chatFailed, setChatFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void sendMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  useEffect(() => {
    if (scrollRef.current !== null) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (text: string) => {
    const newMessages: Message[] = text
      ? [...messages, { role: "user" as const, content: text }]
      : messages;

    if (text) {
      setMessages(newMessages);
      setInput("");
    }

    setSending(true);
    try {
      const res = await fetch("/api/onboarding/zero-me/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, messages: newMessages }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { reply: string };
      const reply = data.reply;

      if (reply.includes(COMPLETION_MARKER)) {
        const markerIdx = reply.indexOf(COMPLETION_MARKER);
        const beforeMarker = reply.slice(0, markerIdx).trim();
        const afterMarker = reply.slice(markerIdx + COMPLETION_MARKER.length).trim();
        const summaryText = afterMarker || beforeMarker;

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: beforeMarker || "Profile captured." },
        ]);
        setSummary(summaryText);
        setCompleted(true);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      }
    } catch {
      setChatFailed(true);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Couldn't reach a chat-capable LLM provider. Set up an API provider or install the Lemonade local runtime — see the banner above." },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || sending) return;
    void sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveAndContinue = async () => {
    setSaving(true);
    try {
      await fetch("/api/onboarding/zero-me/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, content: summary }),
      });
    } catch {
      // Non-fatal
    } finally {
      setSaving(false);
      onNext();
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {chatFailed && <LemonadeBanner context="onboarding" />}
      <div className="onboard-animate-in">
        <h2 className="text-xl sm:text-2xl font-semibold mb-1">
          {DOMAIN_COPY[domain].headline}
        </h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          {DOMAIN_COPY[domain].subtitle}
        </p>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto flex flex-col gap-3 min-h-0 max-h-[50vh] sm:max-h-[400px] pr-1"
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "px-3 sm:px-4 py-2 text-[13px] sm:text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm max-w-[85%] sm:max-w-[75%]"
                  : "bg-card border border-border rounded-2xl rounded-bl-sm max-w-[85%] sm:max-w-[75%]",
              )}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-3 sm:px-4 py-2 text-sm text-muted-foreground">
              <span className="animate-pulse">...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      {!completed && (
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your response..."
            disabled={sending}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={!input.trim() || sending} size="sm">
            Send
          </Button>
        </div>
      )}

      {/* Completion actions */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        {completed && (
          <Button onClick={handleSaveAndContinue} disabled={saving} className="w-full sm:w-auto">
            {saving ? "Saving..." : "Save & Continue"}
          </Button>
        )}
        {!completed && (
          <Button variant="ghost" onClick={onSkip} className="w-full sm:w-auto">
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}
