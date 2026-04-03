/**
 * SetupTerminal — inline streaming terminal for hosting-setup.sh.
 * Expands in-place below the setup banner. Fixed height, scrolling content.
 * Stays visible until the user explicitly closes it.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export interface SetupTerminalProps {
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

export function SetupTerminal({ open, onClose, onComplete }: SetupTerminalProps) {
  const [lines, setLines] = useState<{ type: string; text: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Single effect: starts the stream when `open` flips to true.
  // No other dependencies — refs keep callbacks stable.
  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setLines([]);
    setRunning(true);
    setExitCode(null);

    (async () => {
      try {
        const res = await fetch("/api/hosting/setup", {
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
          setLines([{ type: "error", text: body.error ?? `HTTP ${res.status}` }]);
          setRunning(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;

            try {
              const parsed = JSON.parse(dataLine.slice(6)) as { type: string; text: string };
              if (parsed.type === "exit") {
                setExitCode(Number(parsed.text));
              } else {
                setLines((prev) => [...prev, parsed]);
              }
            } catch {
              // Ignore malformed events
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setLines((prev) => [...prev, { type: "error", text: (err as Error).message }]);
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
        onCompleteRef.current?.();
      }
    })();

    return () => {
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines, exitCode]);

  if (!open) return null;

  return (
    <div className="mb-4 rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-card-foreground">
          Hosting Setup
          {running && (
            <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse" />
          )}
          {exitCode !== null && (
            <span className={exitCode === 0 ? "text-green text-[11px] font-normal" : "text-red text-[11px] font-normal"}>
              {exitCode === 0 ? "completed" : `failed (exit ${exitCode})`}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-[11px] h-6"
            onClick={() => {
              const text = lines.map((l) => l.text).join("");
              void navigator.clipboard.writeText(text);
            }}
          >
            Copy
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-[11px] h-6"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>

      {/* Terminal output — fixed height, scrolls */}
      <div
        ref={scrollRef}
        className="h-[360px] overflow-y-auto bg-[#1e1e2e] px-3 py-2 font-mono text-[12px] leading-[1.6]"
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.type === "error"
                ? "text-red"
                : line.type === "stderr"
                  ? "text-yellow"
                  : "text-green"
            }
          >
            <span className="whitespace-pre-wrap break-all">{line.text}</span>
          </div>
        ))}
        {exitCode !== null && (
          <div className={exitCode === 0 ? "text-green mt-2 font-bold" : "text-red mt-2 font-bold"}>
            {exitCode === 0
              ? "--- Setup completed successfully ---"
              : `--- Setup failed (exit code ${exitCode}) ---`}
          </div>
        )}
      </div>
    </div>
  );
}
