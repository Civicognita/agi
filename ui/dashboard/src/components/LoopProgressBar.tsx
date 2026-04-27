/**
 * LoopProgressBar (s120 t452) — three-state two-tone bar visible in the
 * Aion chat surface, mirroring the Claude Code terminal statusline:
 *   - solid bright green: tasks finished (owner-signed-off)
 *   - dim/striped green:  tasks in QA (Aion-shipped, awaiting sign-off)
 *   - dark gray:          backlog/doing/empty
 *
 * No numbers in the bar itself — hover/click for the breakdown. The gap
 * between solid and striped portions visually communicates "owner-review
 * backlog": large gap = sign-off bottleneck, small gap = healthy throughput.
 *
 * Establishes a shared visual vocabulary between developer harness (Claude
 * Code statusline) and Aion chat surface so the same progress signal is
 * legible from either entry point.
 */

import { useEffect, useState } from "react";

interface LoopProgress {
  finished: number;
  qa: number;
  total: number;
  scopeLabel?: string;
}

export function LoopProgressBar({
  cells = 20,
  refreshMs = 30_000,
}: {
  cells?: number;
  refreshMs?: number;
}): JSX.Element | null {
  const [progress, setProgress] = useState<LoopProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async (): Promise<void> => {
      try {
        const res = await fetch("/api/loop/progress");
        if (!res.ok) {
          if (!cancelled) setProgress(null);
          return;
        }
        const data = (await res.json()) as LoopProgress;
        if (!cancelled) setProgress(data);
      } catch {
        if (!cancelled) setProgress(null);
      }
    };
    void fetchOnce();
    const id = window.setInterval(() => { void fetchOnce(); }, refreshMs);
    return (): void => { cancelled = true; window.clearInterval(id); };
  }, [refreshMs]);

  if (!progress || progress.total === 0) return null;

  const total = Math.max(progress.total, 1);
  const finishedCells = Math.round((progress.finished / total) * cells);
  const qaCells = Math.round((progress.qa / total) * cells);
  const emptyCells = Math.max(cells - finishedCells - qaCells, 0);

  return (
    <div
      title={`${String(progress.finished)} finished · ${String(progress.qa)} qa · ${String(progress.total)} total${progress.scopeLabel ? ` (${progress.scopeLabel})` : ""}`}
      data-testid="loop-progress-bar"
      role="progressbar"
      aria-valuenow={progress.finished}
      aria-valuemin={0}
      aria-valuemax={progress.total}
      style={{ display: "flex", gap: "1px", height: "8px", alignItems: "center" }}
    >
      {Array.from({ length: finishedCells }).map((_, i) => (
        <span
          key={`f${String(i)}`}
          data-testid="loop-progress-cell-finished"
          style={{ flex: 1, height: "100%", backgroundColor: "var(--green, #4ade80)" }}
        />
      ))}
      {Array.from({ length: qaCells }).map((_, i) => (
        <span
          key={`q${String(i)}`}
          data-testid="loop-progress-cell-qa"
          style={{
            flex: 1,
            height: "100%",
            backgroundImage: "repeating-linear-gradient(45deg, var(--green, #4ade80) 0 2px, transparent 2px 4px)",
            backgroundColor: "rgba(74, 222, 128, 0.15)",
          }}
        />
      ))}
      {Array.from({ length: emptyCells }).map((_, i) => (
        <span
          key={`e${String(i)}`}
          data-testid="loop-progress-cell-empty"
          style={{ flex: 1, height: "100%", backgroundColor: "var(--muted, #2a2a2a)" }}
        />
      ))}
      {progress.scopeLabel && (
        <span style={{ marginLeft: "8px", fontSize: "10px", color: "var(--muted-foreground, #888)" }}>
          {progress.scopeLabel}
        </span>
      )}
    </div>
  );
}
