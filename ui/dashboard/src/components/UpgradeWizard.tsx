/**
 * UpgradeWizard — fork-aware 2-step upgrade workflow.
 *
 * Step 1 — Source Selection:
 *   Fetches /api/system/fork-status on open. Displays all available
 *   remote/branch sources with ahead/behind commit counts. User selects
 *   which ref to pull from.
 *
 * Step 2 — Preview:
 *   Fetches /api/system/upgrade-preview for the selected source. Shows
 *   version delta, impact summary (restart / DB / frontend-only), pending
 *   migrations, and changelog. "Merge & Upgrade →" executes the merge then
 *   fires upgrade.sh.
 *
 * Step 3 — Executing:
 *   Streams per-step upgrade progress from the parent-supplied upgradePhase
 *   and upgradeLogs props (driven by the system:upgrade WS event in root.tsx).
 *   After completion the embedded UpgradeNextStepsPanel renders inline.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UpgradeNextStepsPanel } from "@/components/UpgradeNextStepsPanel.js";
import { computeUpgradeStepRows, normalizeStepStatus } from "@/lib/upgrade-steps.js";
import { useTheme } from "@/lib/theme-provider";
import { FancyDiff } from "@particle-academy/fancy-diff";
import {
  fetchForkStatus,
  fetchUpgradePreview,
  mergeForkSource,
  fetchUpgradeHistory,
  addUpgradeHistoryNote,
  fetchChangelog,
  type ChangelogCommit,
} from "@/api.js";
import type {
  ForkStatus,
  ForkBranchInfo,
  UpgradePreview,
  MergeResult,
  SystemUpgradedEvent,
  UpgradeHistoryEntry,
} from "../types.js";

// ---------------------------------------------------------------------------
// Fine-step label map (upgrade.sh phase names → human-readable labels)
// ---------------------------------------------------------------------------

// The upgrade step list + status vocabulary live in @/lib/upgrade-steps.js,
// mirrored from scripts/upgrade.sh (story #216). A drift guard test keeps them
// in sync.

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UpgradeWizardProps {
  open: boolean;
  onClose: () => void;
  /** Coarse upgrade phase from root.tsx ("pulling" | "building" | "restarting" | "complete" | "error" | null) */
  upgradePhase: string | null;
  /** Fine-step log entries from upgrade.sh, streamed via WS. */
  upgradeLogs: { step: string; status: string; message: string; timestamp: string }[];
  /** Set by root.tsx when system:upgraded event fires. */
  upgradedEvent: SystemUpgradedEvent | null;
  /** Whether the post-upgrade steps panel should be shown. */
  showUpgradePanel: boolean;
  /** Called when user closes the post-upgrade steps panel. */
  onCloseUpgradePanel: () => void;
  /** Starts upgrade.sh and sets up completion polling — provided by root.tsx. */
  doUpgrade: () => void;
}

type Step = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UpgradeWizard({
  open,
  onClose,
  upgradePhase,
  upgradeLogs,
  upgradedEvent,
  showUpgradePanel,
  onCloseUpgradePanel,
  doUpgrade,
}: UpgradeWizardProps) {
  const [step, setStep] = useState<Step>(1);

  // Resolve the dashboard's active light/dark so the diff viewer can be told
  // explicitly — fancy-diff's `theme="auto"` does NOT actually detect dark mode
  // (no media-query / .dark-class probe), so we must pass the real value.
  const { themeId, themes } = useTheme();
  const isDarkTheme = themes.find((t) => t.id === themeId)?.dark ?? true;

  // Step 1 state
  const [forkStatus, setForkStatus] = useState<ForkStatus | null>(null);
  const [forkLoading, setForkLoading] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string>("");

  // Step 2 state
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Merge state (step 2 → 3 transition)
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeConflict, setMergeConflict] = useState<MergeResult | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);

  // Merge result to display in step 3
  const [mergeResult, setMergeResult] = useState<{ fastForward: boolean; commits: number } | null>(null);

  // Recent changelog — surfaced in the "up to date" state so the running
  // changelog (what changed in the last upgrade) is always reachable, not just
  // in the transient post-upgrade panel.
  const [recentCommits, setRecentCommits] = useState<ChangelogCommit[]>([]);

  // Track already-seen fine steps so the list grows monotonically
  const seenStepsRef = useRef<Map<string, { status: string; message: string }>>(new Map());

  // History panel state
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<UpgradeHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [noteEntryId, setNoteEntryId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  // Load history when history panel opens
  useEffect(() => {
    if (!showHistory) return;
    setHistoryLoading(true);
    fetchUpgradeHistory()
      .then(({ entries }) => { setHistory(entries); setHistoryLoading(false); })
      .catch(() => setHistoryLoading(false));
  }, [showHistory]);

  const handleSaveNote = useCallback(async (id: string) => {
    if (!noteDraft.trim()) return;
    await addUpgradeHistoryNote(id, noteDraft).catch(() => {});
    setHistory(prev => prev.map(e => e.id === id ? { ...e, resolutionNote: noteDraft } : e));
    setNoteEntryId(null);
    setNoteDraft("");
  }, [noteDraft]);

  // Load fork status on open
  useEffect(() => {
    if (!open) return;
    setStep(upgradePhase !== null ? 3 : 1);
    if (upgradePhase !== null) return; // already upgrading — skip to step 3

    setForkLoading(true);
    setForkError(null);
    fetchForkStatus()
      .then((status) => {
        setForkStatus(status);
        // Only real upgrades (strictly-newer VERSION) are actionable. Pre-select
        // the current-channel upgrade if it's a real one, else the first real
        // upgrade. When everything is up-to-date / behind / older, nothing is
        // selected — the wizard shows an informational state with no review
        // action. Gating on `isUpgrade` (not mergeType) keeps upstream/main —
        // which trails by merge bubbles — out of the actionable set.
        const realUpgrades = status.sources.filter((s) => s.isUpgrade);
        const preselect = realUpgrades.find((s) => s.isCurrentChannel) ?? realUpgrades[0];
        if (preselect) setSelectedSource(preselect.ref);
        setForkLoading(false);
      })
      .catch((err: unknown) => {
        setForkError(err instanceof Error ? err.message : "Failed to load fork status");
        setForkLoading(false);
      });
  }, [open, upgradePhase]);

  // Load the recent changelog on open so the "up to date" state can show what
  // changed (the running changelog) instead of a dead-end.
  useEffect(() => {
    if (!open) return;
    fetchChangelog(8).then(({ commits }) => setRecentCommits(commits)).catch(() => {});
  }, [open]);

  // Dismiss on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== 3) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, step, onClose]);

  // Keep seenSteps current as upgradeLogs grows
  useEffect(() => {
    for (const entry of upgradeLogs) {
      if (entry.step) {
        seenStepsRef.current.set(entry.step, { status: entry.status, message: entry.message });
      }
    }
  }, [upgradeLogs]);

  // Reset state when closed
  useEffect(() => {
    if (!open) {
      setStep(1);
      setForkStatus(null);
      setForkError(null);
      setPreview(null);
      setPreviewError(null);
      setMergeConflict(null);
      setMergeResult(null);
      setDoctorError(null);
      seenStepsRef.current.clear();
    }
  }, [open]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handlePreview = useCallback(() => {
    if (!selectedSource) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    fetchUpgradePreview(selectedSource)
      .then((p) => { setPreview(p); setPreviewLoading(false); setStep(2); })
      .catch((err: unknown) => {
        setPreviewError(err instanceof Error ? err.message : "Failed to load preview");
        setPreviewLoading(false);
      });
  }, [selectedSource]);

  const handleMergeAndUpgrade = useCallback(async () => {
    if (!selectedSource) return;
    setMergeLoading(true);
    setMergeConflict(null);
    setDoctorError(null);

    try {
      const result = await mergeForkSource(selectedSource);
      if (!result.ok && result.aborted) {
        // Conflict detected — auto-invoke Doctor without waiting for user input
        setMergeConflict(result);
        setDoctorLoading(true);
        try {
          const res = await fetch("/api/system/doctor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "resolve-merge" }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error ?? `HTTP ${res.status}`);
          }
          // Doctor resolved — clear conflict state, continue to upgrade
          setMergeConflict(null);
          setDoctorLoading(false);
          setMergeLoading(false);
          setMergeResult({ fastForward: result.fastForward, commits: result.mergedCommits });
          setStep(3);
          doUpgrade();
        } catch (err: unknown) {
          // Doctor failed — surface error and "Pick different source" fallback
          setDoctorError(err instanceof Error ? err.message : "Aion Doctor could not resolve conflicts");
          setDoctorLoading(false);
          setMergeLoading(false);
        }
        return;
      }
      setMergeResult({ fastForward: result.fastForward, commits: result.mergedCommits });
      setStep(3);
      doUpgrade();
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : "Merge failed");
    }
    setMergeLoading(false);
  }, [selectedSource, doUpgrade]);


  if (!open) return null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const upgradeComplete = upgradePhase === "complete";
  const upgradeError = upgradePhase === "error";

  // Build ordered step rows for step 3 from accumulated log entries
  // The FULL checklist, always — every step renders immediately (pending) and
  // flips green as upgrade.sh reports `done` for it (story #216). No filtering.
  const stepRows = computeUpgradeStepRows(seenStepsRef.current);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function StepIndicator() {
    const steps = [
      { n: 1, label: "Source" },
      { n: 2, label: "Preview" },
      { n: 3, label: "Executing" },
    ] as const;
    return (
      <div className="flex items-center gap-0 border-b border-border">
        {steps.map(({ n, label }, i) => (
          <div key={n} className="flex items-center">
            <button
              data-testid={`upgrade-wizard-step-indicator-${n}`}
              data-active={step === n ? "true" : "false"}
              disabled={n >= step || step === 3}
              onClick={() => { if (n < step && step !== 3) setStep(n as Step); }}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-xs font-medium transition-colors",
                step === n
                  ? "text-foreground border-b-2 border-primary -mb-px"
                  : n < step && step !== 3
                  ? "text-muted-foreground hover:text-foreground cursor-pointer"
                  : "text-muted-foreground/50 cursor-default",
              )}
            >
              <span className={cn(
                "inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold",
                step === n ? "bg-primary text-primary-foreground"
                  : n < step ? "bg-green text-white"
                  : "bg-muted text-muted-foreground",
              )}>
                {n < step ? "✓" : n}
              </span>
              {label}
            </button>
            {i < steps.length - 1 && (
              <span className="text-border text-xs mx-0.5">›</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  function SourceCard({ source, selected, onSelect }: {
    source: ForkBranchInfo;
    selected: boolean;
    onSelect: () => void;
  }) {
    const isBehind = source.mergeType === "behind";
    const upToDate = source.mergeType === "up-to-date";
    // The review/upgrade action only appears for a REAL upgrade (strictly-newer
    // version), never on raw topology. A source that is fast-forward/three-way
    // by commits but NOT newer by version (the upstream/main merge-bubble case)
    // is "older" — informational, not actionable.
    const canUpgrade = source.isUpgrade;
    const isOlder = !canUpgrade && !isBehind && !upToDate;
    const currentVersion = forkStatus?.currentVersion;

    // Owner directive: the source listing + commit deltas are ALWAYS shown, but
    // the review/upgrade action only appears for a real upgrade.
    // up-to-date, behind, and older sources render as non-interactive info rows.
    if (isBehind) {
      // Info row — our fork is ahead of this source; nothing to pull.
      return (
        <div
          data-testid="upgrade-source-info"
          data-merge-type="behind"
          className="flex items-center gap-3 rounded-lg border border-border/40 bg-surface0/30 px-3 py-2"
        >
          <span className="w-2 h-2 rounded-full bg-muted shrink-0" />
          <span className="text-[11px] text-muted-foreground flex-1 truncate">{source.label}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {source.isCurrentChannel && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-blue/10 text-blue/70 font-semibold">Current</span>
            )}
            <span className="text-[9px] text-muted-foreground/70">
              your fork is {source.commitsAhead} ahead — nothing to pull
            </span>
          </div>
        </div>
      );
    }

    if (upToDate) {
      // Info row — already up to date; no review action.
      return (
        <div
          data-testid="upgrade-source-info"
          data-merge-type="up-to-date"
          className="flex items-center gap-3 rounded-lg border border-border/40 bg-surface0/30 px-3 py-2"
        >
          <span className="w-2 h-2 rounded-full bg-green/50 shrink-0" />
          <span className="text-[11px] text-muted-foreground flex-1 truncate">{source.label}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {source.isCurrentChannel && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-blue/10 text-blue/70 font-semibold">Current</span>
            )}
            <span className="text-[9px] text-green/70 font-semibold">✓ up to date</span>
          </div>
        </div>
      );
    }

    if (isOlder) {
      // Info row — the source has commits we don't (merge bubbles), but its
      // VERSION is older than ours. This is the upstream/main case for a
      // custodian: pulling it would be a phantom "downgrade", so no action.
      return (
        <div
          data-testid="upgrade-source-info"
          data-merge-type="older"
          className="flex items-center gap-3 rounded-lg border border-border/40 bg-surface0/30 px-3 py-2"
        >
          <span className="w-2 h-2 rounded-full bg-muted shrink-0" />
          <span className="text-[11px] text-muted-foreground flex-1 truncate">{source.label}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {source.isCurrentChannel && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-blue/10 text-blue/70 font-semibold">Current</span>
            )}
            <span className="text-[9px] text-muted-foreground/70">
              {source.latestVersion ? `v${source.latestVersion}` : "this source"}
              {currentVersion ? ` — older than your v${currentVersion}` : " — older than yours"}, nothing to pull
            </span>
          </div>
        </div>
      );
    }

    // Upgradeable card — large, prominent, the user's attention goes here
    const mergeColor = source.hasConflicts ? "red" : source.mergeType === "fast-forward" ? "green" : "yellow";
    const MERGE_LABELS = {
      "fast-forward": { label: "Clean fast-forward", bg: "bg-green/10", text: "text-green" },
      "three-way":    { label: source.hasConflicts ? "Conflicts detected" : "3-way merge", bg: source.hasConflicts ? "bg-red/10" : "bg-yellow/10", text: source.hasConflicts ? "text-red" : "text-yellow" },
    } as Record<string, { label: string; bg: string; text: string }>;
    const mergeTag = MERGE_LABELS[source.mergeType] ?? { label: "", bg: "", text: "" };

    return (
      <button
        data-testid={source.isCurrentChannel ? "upgrade-source-card-current" : "upgrade-source-card"}
        data-selected={selected ? "true" : "false"}
        onClick={onSelect}
        className={cn(
          "w-full text-left rounded-xl border-2 p-4 transition-all group",
          selected
            ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
            : mergeColor === "red"
            ? "border-red/30 bg-red/5 hover:border-red/50"
            : "border-yellow/30 bg-yellow/5 hover:border-yellow/50 hover:shadow-sm",
        )}
      >
        <div className="flex items-start gap-3">
          {/* Radio dot */}
          <span className={cn(
            "mt-1 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
            selected
              ? "border-primary bg-primary"
              : mergeColor === "red" ? "border-red/50" : "border-yellow/50 group-hover:border-yellow",
          )}>
            {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
          </span>

          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[14px] font-bold text-foreground">{source.label}</span>
              {source.isCurrentChannel && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue/15 text-blue font-bold uppercase tracking-wide">
                  Current channel
                </span>
              )}
              {source.isUpstream && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface1 text-muted-foreground font-semibold">
                  Upstream
                </span>
              )}
            </div>

            {/* Commit delta — the main hook */}
            <div className={cn(
              "text-[15px] font-semibold mb-1.5",
              mergeColor === "red" ? "text-red" : mergeColor === "green" ? "text-green" : "text-yellow",
            )}>
              ↑ {source.commitsBehind} commit{source.commitsBehind !== 1 ? "s" : ""} available
              {source.latestVersion && (
                <span className="ml-2 text-[12px] font-mono text-muted-foreground">→ v{source.latestVersion}</span>
              )}
            </div>

            {/* Merge type + installed-ahead warning */}
            <div className="flex items-center gap-2 flex-wrap">
              {mergeTag.label && (
                <span className={cn("text-[10px] px-2 py-0.5 rounded font-semibold", mergeTag.bg, mergeTag.text)}>
                  {mergeTag.label}
                </span>
              )}
              {source.commitsAhead > 0 && (
                <span className="text-[10px] text-muted-foreground/70">
                  your fork has {source.commitsAhead} commit{source.commitsAhead !== 1 ? "s" : ""} not yet in this source
                </span>
              )}
            </div>

            {/* Latest commit preview */}
            {source.latestCommit && (
              <div className="text-[10px] text-muted-foreground mt-1.5 truncate font-mono">
                {source.latestCommit.hash.slice(0, 7)}{" "}
                <span className="font-sans">{source.latestCommit.message}</span>
              </div>
            )}
          </div>

          {/* Arrow chevron — call to action */}
          {canUpgrade && !selected && (
            <span className={cn(
              "text-[18px] shrink-0 mt-1 opacity-40 group-hover:opacity-80 transition-opacity",
              mergeColor === "red" ? "text-red" : "text-yellow",
            )}>›</span>
          )}
          {selected && (
            <span className="text-[18px] shrink-0 mt-1 text-primary">✓</span>
          )}
        </div>
      </button>
    );
  }

  // One consistent status language for every step row (both the merge-result
  // group and the upgrade.sh steps). The raw status is normalized first so
  // upgrade.sh's "done"/"warn"/"error" AND the merge rows' "ok"/"start" all map
  // correctly: green check = done, yellow check = done-with-warning, muted dash
  // = skipped (NOT green), pulsing blue dot = running, red × = failed, hollow
  // grey ring = pending. Done text is muted (readable); only skipped is struck.
  function StepStatusIcon({ status }: { status: string }) {
    const s = normalizeStepStatus(status);
    return (
      <span className="w-3.5 inline-flex items-center justify-center shrink-0 text-[11px] leading-none">
        {s === "done" && <span className="text-green font-semibold" aria-label="done">✓</span>}
        {s === "warn" && <span className="text-yellow font-semibold" aria-label="done with warning">✓</span>}
        {s === "skip" && <span className="text-muted-foreground/50 font-semibold" aria-label="skipped">–</span>}
        {s === "running" && <span className="w-2 h-2 rounded-full bg-blue animate-pulse" aria-label="running" />}
        {s === "error" && <span className="text-red font-semibold" aria-label="failed">✕</span>}
        {s === "pending" && <span className="w-2 h-2 rounded-full border border-muted-foreground/40" aria-label="pending" />}
      </span>
    );
  }

  function StepRow({ label, status, first }: { label: string; status: string; first?: boolean }) {
    const s = normalizeStepStatus(status);
    return (
      <div className={cn("flex items-center gap-2.5 py-1.5", !first && "border-t border-border/50")}>
        <StepStatusIcon status={status} />
        <span className={cn(
          "text-[12px]",
          s === "done" ? "text-muted-foreground"
            : s === "skip" ? "text-muted-foreground line-through decoration-muted-foreground/40"
            : s === "running" ? "text-foreground font-medium"
            : s === "warn" ? "text-foreground"
            : s === "error" ? "text-red font-medium"
            : "text-muted-foreground/50",
        )}>
          {label}
        </span>
        {s === "running" && <span className="text-[10px] text-blue ml-auto">running…</span>}
        {s === "warn" && <span className="text-[10px] text-yellow ml-auto">done · warning</span>}
        {s === "error" && <span className="text-[10px] text-red ml-auto">failed</span>}
        {s === "skip" && <span className="text-[10px] text-muted-foreground/60 ml-auto">skipped</span>}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div
      data-testid="upgrade-wizard-overlay"
      className="fixed inset-0 z-[400] flex flex-col bg-background"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <span className="text-[15px] font-bold text-foreground">Upgrade Manager</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHistory(h => !h)}
            className={cn(
              "text-[12px] font-medium px-2.5 py-1 rounded transition-colors",
              showHistory
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-surface0",
            )}
          >
            History
          </button>
          {(step !== 3 || showHistory) && (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-xl leading-none px-1"
              aria-label="Close upgrade wizard"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {!showHistory && <StepIndicator />}

      {/* History panel (replaces step body when toggled) */}
      {showHistory && (
        <div className="flex-1 overflow-y-auto" data-testid="upgrade-history-panel">
          <div className="max-w-2xl mx-auto w-full px-5 py-6">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              Upgrade History
            </div>

            {historyLoading && (
              <div className="text-[12px] text-muted-foreground animate-pulse py-8 text-center">
                Loading history…
              </div>
            )}

            {!historyLoading && history.length === 0 && (
              <div className="text-[12px] text-muted-foreground py-8 text-center">
                No upgrade history yet. History is recorded after the first upgrade run.
              </div>
            )}

            {!historyLoading && history.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "rounded-lg border p-4 mb-3",
                  entry.success ? "border-border bg-card" : "border-red/20 bg-red/5",
                )}
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase",
                        entry.success ? "bg-green/15 text-green" : "bg-red/15 text-red",
                      )}>
                        {entry.success ? "Success" : "Failed"}
                      </span>
                      <span className="font-mono text-[12px] text-foreground font-semibold">
                        v{entry.fromVersion} → v{entry.toVersion}
                      </span>
                      {entry.source && (
                        <span className="text-[10px] text-muted-foreground font-mono">{entry.source}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(entry.startedAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Failure detail */}
                {!entry.success && entry.errorMessage && (
                  <div className="text-[11px] text-red/80 bg-red/5 rounded px-2 py-1.5 mb-2 font-mono">
                    {entry.failedAtStep && <span className="font-bold mr-1">[{entry.failedAtStep}]</span>}
                    {entry.errorMessage}
                  </div>
                )}

                {/* Resolution note */}
                {entry.resolutionNote && (
                  <div className="text-[11px] text-green/80 bg-green/5 rounded px-2 py-1.5 mb-2">
                    <span className="font-semibold text-green/90 mr-1">Resolution:</span>
                    {entry.resolutionNote}
                  </div>
                )}

                {/* Add / edit resolution note for failed entries */}
                {!entry.success && (
                  noteEntryId === entry.id ? (
                    <div className="flex gap-2 mt-2">
                      <input
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        placeholder="Describe how this failure was resolved…"
                        className="flex-1 text-[11px] bg-background border border-border rounded px-2 py-1 outline-none focus:border-primary"
                      />
                      <Button size="sm" onClick={() => void handleSaveNote(entry.id)} className="text-[11px] h-7">Save</Button>
                      <Button size="sm" variant="outline" onClick={() => { setNoteEntryId(null); setNoteDraft(""); }} className="text-[11px] h-7">Cancel</Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setNoteEntryId(entry.id); setNoteDraft(entry.resolutionNote ?? ""); }}
                      className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
                    >
                      {entry.resolutionNote ? "Edit resolution note" : "+ Add resolution note"}
                    </button>
                  )
                )}

                {/* Collapsible log */}
                {entry.log.length > 0 && (
                  <details className="group mt-2">
                    <summary className="text-[10px] text-muted-foreground cursor-pointer list-none flex items-center gap-1 select-none">
                      <span className="group-open:rotate-90 inline-block transition-transform">›</span>
                      Step log ({entry.log.length} entries)
                    </summary>
                    <div className="mt-1 max-h-[120px] overflow-y-auto rounded bg-surface0 border border-border p-2 font-mono text-[9px] space-y-0.5">
                      {entry.log.map((l, i) => (
                        <div key={i} className={l.status === "fail" ? "text-red" : "text-subtext0"}>
                          <span className="text-subtext1">[{l.step}:{l.status}]</span> {l.message}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body — scrollable */}
      {!showHistory && <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto w-full px-5 py-6">

          {/* ------------------------------------------------------------------ */}
          {/* STEP 1 — Source Selection */}
          {/* ------------------------------------------------------------------ */}

          {step === 1 && (
            <div data-testid="upgrade-wizard-step-1" className="flex flex-col gap-4">
              {/* Current state chip */}
              {forkStatus && (
                <div className="text-[11px] text-muted-foreground bg-surface0 rounded-lg px-3 py-2 font-mono">
                  {forkStatus.devModeEnabled ? "fork" : "upstream"} · {forkStatus.currentBranch} · v{forkStatus.currentVersion}
                </div>
              )}

              {forkLoading && (
                <div className="text-[12px] text-muted-foreground py-6 text-center animate-pulse">
                  Fetching remote status…
                </div>
              )}

              {forkError && (
                <div className="text-[12px] text-red bg-red/5 border border-red/20 rounded-lg px-3 py-2">
                  {forkError}
                </div>
              )}

              {!forkLoading && !forkError && forkStatus && (() => {
                const upstreamSources = forkStatus.sources.filter(s => s.isUpstream);
                const forkSources = forkStatus.sources.filter(s => !s.isUpstream);
                return (
                  <div className="flex flex-col gap-4">
                    {/* Upstream — always shown */}
                    <div>
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Upstream
                      </div>
                      <div className="flex flex-col gap-2">
                        {upstreamSources.map((source) => (
                          <SourceCard
                            key={source.ref}
                            source={source}
                            selected={selectedSource === source.ref}
                            onSelect={() => setSelectedSource(source.ref)}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Fork — only in Dev Mode */}
                    {forkStatus.devModeEnabled && forkSources.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Your fork
                        </div>
                        <div className="flex flex-col gap-2">
                          {forkSources.map((source) => (
                            <SourceCard
                              key={source.ref}
                              source={source}
                              selected={selectedSource === source.ref}
                              onSelect={() => setSelectedSource(source.ref)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}


              {previewError && (
                <div className="text-[12px] text-red bg-red/5 border border-red/20 rounded-lg px-3 py-2">
                  {previewError}
                </div>
              )}

              {/* Footer — the review action only exists when a real upgrade is
                  available. Up-to-date installs see a clear "nothing to review"
                  state instead of a dangling Preview button. */}
              {!forkLoading && forkStatus && (() => {
                const hasRealUpgrade = forkStatus.sources.some((s) => s.isUpgrade);
                if (!hasRealUpgrade) {
                  return (
                    <div data-testid="upgrade-no-upgrades" className="flex flex-col gap-3">
                      <div className="flex items-center gap-2 justify-center text-[12px] text-green/80 bg-green/5 border border-green/15 rounded-lg px-3 py-3">
                        <span>✓</span> You're up to date — nothing to review.
                      </div>
                      {/* Running changelog — what changed in recent upgrades, so this
                          state is informative rather than a dead-end. */}
                      {recentCommits.length > 0 && (
                        <div data-testid="upgrade-recent-changelog" className="rounded-lg border border-border bg-surface1 p-3">
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">What changed recently</div>
                          <div className="space-y-1">
                            {recentCommits.slice(0, 6).map((c) => (
                              <div key={c.hash} className="flex items-start gap-2 text-[11px]">
                                <span className="font-mono text-muted-foreground shrink-0">{c.hash.slice(0, 7)}</span>
                                <span className="text-foreground leading-relaxed">{c.subject}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="flex justify-end pt-1">
                    <Button
                      data-testid="upgrade-wizard-preview-btn"
                      onClick={handlePreview}
                      disabled={!selectedSource || forkLoading || previewLoading}
                    >
                      {previewLoading ? "Loading…" : "Review →"}
                    </Button>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* STEP 2 — Upgrade Preview */}
          {/* ------------------------------------------------------------------ */}

          {step === 2 && (
            <div data-testid="upgrade-wizard-step-2" className="flex flex-col gap-5">
              {/* Version delta */}
              {preview && (
                <div
                  data-testid="upgrade-preview-version-delta"
                  className="flex items-center gap-2 font-mono text-[13px]"
                >
                  <span className="text-muted-foreground">v{preview.fromVersion}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-bold text-foreground">v{preview.toVersion}</span>
                  <span className="text-[11px] text-muted-foreground ml-1">
                    · {preview.commitCount} commit{preview.commitCount !== 1 ? "s" : ""}
                  </span>
                </div>
              )}

              {/* Impact row */}
              {preview && (
                <div
                  data-testid="upgrade-preview-impact-row"
                  className="flex items-center gap-2 flex-wrap"
                >
                  {preview.impact.requiresRestart && (
                    <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-yellow/10 text-yellow border border-yellow/20">
                      <span>↺</span> Service restart
                    </span>
                  )}
                  {preview.impact.requiresDbMigration && (
                    <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-blue/10 text-blue border border-blue/20">
                      <span>⊞</span> DB migration
                    </span>
                  )}
                  {preview.impact.frontendOnly && !preview.impact.requiresRestart && (
                    <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-green/10 text-green border border-green/20">
                      <span>⚡</span> Frontend only
                    </span>
                  )}
                  {preview.impact.changedAreas.map((area) => (
                    <span key={area} className="text-[10px] px-1.5 py-0.5 rounded bg-surface1 text-muted-foreground">
                      {area}
                    </span>
                  ))}
                </div>
              )}

              {/* Migrations */}
              {preview && preview.migrations.length > 0 && (
                <div className="rounded-lg border border-border bg-card">
                  <div className="px-3 py-2 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Migrations ({preview.migrations.length})
                  </div>
                  <div className="divide-y divide-border">
                    {preview.migrations.map((m) => (
                      <div key={m.id} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground">v{m.version}</span>
                          <span className="text-[11px] font-medium text-foreground">{m.id}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{m.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File diff — all changed files between deployed and target */}
              {preview && (preview.fileDiff ?? preview.diffStat) && (
                <div data-testid="upgrade-preview-changelog" className="rounded-lg border border-border overflow-hidden">
                  <div className="px-3 py-2 border-b border-border bg-card text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                    <span>Changed files ({preview.impact.changedAreas.join(", ") || "all areas"})</span>
                    {!preview.fileDiff && preview.diffStat && (
                      <span className="text-[9px] text-amber font-normal normal-case">diff too large — showing file list</span>
                    )}
                  </div>
                  {preview.fileDiff ? (
                    <div className="text-[11px] overflow-auto max-h-[420px]">
                      {/* Read-only comparison — the upgrade preview is informational,
                          it must NOT carry the accept/reject acceptance UX (fancy-diff
                          0.2.0 `variant="compare"`, owner directive 2026-06-12). */}
                      <FancyDiff
                        source={{ unified: preview.fileDiff }}
                        variant="compare"
                        mode="inline"
                        theme={isDarkTheme ? "dark" : "light"}
                      />
                    </div>
                  ) : (
                    <pre className="px-3 py-2 text-[10px] font-mono text-muted-foreground overflow-auto max-h-[320px] bg-surface0 whitespace-pre">
                      {preview.diffStat}
                    </pre>
                  )}
                </div>
              )}

              {/* Commit list */}
              {preview && preview.commits.length > 0 && (
                <details className="group" open={!(preview.fileDiff ?? preview.diffStat)}>
                  <summary className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 cursor-pointer list-none flex items-center gap-1 select-none">
                    <span className="group-open:rotate-90 inline-block transition-transform">›</span>
                    Commits ({preview.commits.length})
                  </summary>
                  <div className="rounded-lg border border-border bg-card divide-y divide-border max-h-[200px] overflow-y-auto">
                    {preview.commits.map((c) => (
                      <div key={c.hash} className="flex items-start gap-2 px-3 py-1.5 text-[11px]">
                        <span className="font-mono text-muted-foreground shrink-0 mt-px">{c.hash.slice(0, 7)}</span>
                        <span className="text-foreground leading-relaxed">{c.message}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* No commits */}
              {preview && preview.commitCount === 0 && (
                <div className="text-[12px] text-muted-foreground bg-surface0 rounded-lg px-3 py-3 text-center">
                  Already up to date — no commits to merge.
                </div>
              )}

              {/* Merge conflict panel — auto-resolving via Aion Doctor */}
              {mergeConflict && (
                <div className="rounded-lg border border-amber/30 bg-amber/5 p-3">
                  <div className="text-[12px] font-semibold text-amber mb-1 flex items-center gap-2">
                    {doctorLoading ? (
                      <>
                        <span className="inline-block w-3 h-3 rounded-full border-2 border-amber border-t-transparent animate-spin" />
                        Aion Doctor resolving {mergeConflict.conflicts?.length ?? 0} conflict{(mergeConflict.conflicts?.length ?? 0) !== 1 ? "s" : ""}…
                      </>
                    ) : (
                      <>Merge conflict — {mergeConflict.conflicts?.length ?? 0} file{(mergeConflict.conflicts?.length ?? 0) !== 1 ? "s" : ""}</>
                    )}
                  </div>
                  <div className="mb-2 space-y-0.5 max-h-[80px] overflow-y-auto">
                    {(mergeConflict.conflicts ?? []).map((f) => (
                      <div key={f} className="font-mono text-[10px] text-muted-foreground">{f}</div>
                    ))}
                  </div>
                  {doctorError && (
                    <>
                      <p className="text-[11px] text-red mb-2">{doctorError}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setMergeConflict(null); setDoctorError(null); setStep(1); }}
                        className="text-[11px] h-7"
                      >
                        Pick different source
                      </Button>
                    </>
                  )}
                </div>
              )}

              {previewError && !mergeConflict && (
                <div className="text-[12px] text-red bg-red/5 border border-red/20 rounded-lg px-3 py-2">
                  {previewError}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-start justify-between pt-2 gap-4">
                <Button
                  data-testid="upgrade-wizard-back-btn"
                  variant="outline"
                  onClick={() => { setStep(1); setMergeConflict(null); }}
                >
                  ← Back
                </Button>
                {!mergeConflict && preview && preview.commitCount > 0 && (
                  <div className="flex flex-col items-end gap-1.5">
                    {/* Flow explanation — what the button will actually do */}
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="px-1.5 py-0.5 rounded bg-surface1">1</span>
                      <span>Merge {preview.commitCount} commit{preview.commitCount !== 1 ? "s" : ""} from <span className="font-mono">{preview.source}</span></span>
                      <span className="text-muted-foreground/40">→</span>
                      <span className="px-1.5 py-0.5 rounded bg-surface1">2</span>
                      <span>Push to your fork</span>
                      <span className="text-muted-foreground/40">→</span>
                      <span className="px-1.5 py-0.5 rounded bg-surface1">3</span>
                      <span>Run upgrade</span>
                    </div>
                    <Button
                      onClick={() => void handleMergeAndUpgrade()}
                      disabled={mergeLoading}
                    >
                      {mergeLoading
                        ? "Merging & pushing…"
                        : `Merge, push & upgrade →`}
                    </Button>
                  </div>
                )}
                {!mergeConflict && preview?.commitCount === 0 && (
                  <Button disabled>Already up to date</Button>
                )}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* STEP 3 — Executing */}
          {/* ------------------------------------------------------------------ */}

          {step === 3 && (
            <div data-testid="upgrade-wizard-step-3" className="flex flex-col gap-4">
              {/* Merge + push result — same StepRow language as the steps below. */}
              {mergeResult && (
                <div className="rounded-lg border border-border bg-card px-3 py-1.5">
                  <StepRow
                    first
                    status="ok"
                    label={`Merged ${mergeResult.commits} commit${mergeResult.commits !== 1 ? "s" : ""}${mergeResult.fastForward ? " (fast-forward)" : " (3-way merge)"}`}
                  />
                  <StepRow status="ok" label="Pushed to origin — fork updated" />
                  <StepRow status={upgradeComplete ? "ok" : "start"} label="Running upgrade.sh" />
                </div>
              )}

              {/* Step progress */}
              <div className="rounded-lg border border-border bg-card px-3 py-1.5">
                {stepRows.length === 0 && !upgradeComplete && !upgradeError && (
                  <div className="py-4 text-center text-[12px] text-muted-foreground animate-pulse">
                    Starting upgrade…
                  </div>
                )}
                {stepRows.map((row, i) => (
                  <StepRow key={row.key} label={row.label} status={row.status} first={i === 0} />
                ))}
                {upgradeError && (
                  <div className="flex items-center gap-2 py-1.5 border-t border-border/50">
                    <span className="w-2 h-2 rounded-full bg-red shrink-0" />
                    <span className="text-[12px] text-red font-medium">Upgrade failed — check the log below</span>
                  </div>
                )}
              </div>

              {/* Live log */}
              {upgradeLogs.length > 0 && (
                <details className="group">
                  <summary className="text-[11px] text-muted-foreground cursor-pointer list-none flex items-center gap-1 select-none">
                    <span className="group-open:rotate-90 inline-block transition-transform">›</span>
                    Live log ({upgradeLogs.length} entries)
                  </summary>
                  <div className="mt-1.5 rounded-lg bg-surface0 border border-border p-2 max-h-[160px] overflow-y-auto font-mono text-[10px] space-y-0.5">
                    {upgradeLogs.map((entry, i) => (
                      <div key={i} className={cn(
                        "flex gap-2",
                        entry.status === "fail" ? "text-red" : "text-subtext0",
                      )}>
                        <span className="text-subtext1 shrink-0">[{entry.step}:{entry.status}]</span>
                        <span className="truncate">{entry.message}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Post-upgrade steps (after completion) */}
              {upgradeComplete && upgradedEvent && (
                <UpgradeNextStepsPanel
                  open={showUpgradePanel}
                  toVersion={upgradedEvent.toVersion}
                  fromVersion={upgradedEvent.fromVersion}
                  embedded
                  onClose={onCloseUpgradePanel}
                />
              )}

              {upgradeComplete && !upgradedEvent && (
                <div className="text-center py-4">
                  <div className="text-[14px] font-bold text-green mb-1">Upgrade complete</div>
                  <p className="text-[12px] text-muted-foreground">The service is restarting. The page will reload automatically.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
