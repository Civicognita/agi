/**
 * RepoPanel — Full git management panel for expanded project cards.
 *
 * Replaces the read-only git info section with interactive fetch/pull/push,
 * staging/unstaging, commits, diffs, stash, branch management, and history.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { execGitAction } from "../api.js";
import type {
  GitActionResult,
  GitBranchEntry,
  GitCommitEntry,
  GitFileEntry,
  GitRemoteEntry,
  GitStashEntry,
  GitStatusResult,
} from "../types.js";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RepoPanelProps {
  projectPath: string;
  theme?: "light" | "dark";
}

export interface RepoPanelHandle {
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RepoPanel = forwardRef<RepoPanelHandle, RepoPanelProps>(function RepoPanel({ projectPath }, ref) {
  // State
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [commits, setCommits] = useState<GitCommitEntry[]>([]);
  const [remotes, setRemotes] = useState<GitRemoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<string | null>(null);

  // Inputs
  const [commitMsg, setCommitMsg] = useState("");
  const [stashMsg, setStashMsg] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [newRemoteName, setNewRemoteName] = useState("origin");
  const [newRemoteUrl, setNewRemoteUrl] = useState("");

  // Section toggle
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    changes: true,
    stash: false,
    branches: false,
    history: true,
    remotes: false,
  });
  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Mounted ref for cleanup
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // -------------------------------------------------------------------------
  // Refresh all data
  // -------------------------------------------------------------------------

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const results = await Promise.allSettled([
        execGitAction<GitStatusResult>(projectPath, "status"),
        execGitAction<GitActionResult & { branches: GitBranchEntry[] }>(projectPath, "branch_list"),
        execGitAction<GitActionResult & { stashes: GitStashEntry[] }>(projectPath, "stash_list"),
        execGitAction<GitActionResult & { commits: GitCommitEntry[] }>(projectPath, "log"),
        execGitAction<GitActionResult & { remotes: GitRemoteEntry[] }>(projectPath, "remote_list"),
      ]);
      if (!mountedRef.current) return;

      if (results[0]!.status === "fulfilled") setStatus(results[0]!.value);
      if (results[1]!.status === "fulfilled") setBranches(results[1]!.value.branches ?? []);
      if (results[2]!.status === "fulfilled") setStashes(results[2]!.value.stashes ?? []);
      if (results[3]!.status === "fulfilled") setCommits(results[3]!.value.commits ?? []);
      if (results[4]!.status === "fulfilled") setRemotes(results[4]!.value.remotes ?? []);
    } catch (err) {
      if (mountedRef.current) setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { void refreshAll(); }, [refreshAll]);

  useImperativeHandle(ref, () => ({ refresh: () => { void refreshAll(); } }), [refreshAll]);

  // -------------------------------------------------------------------------
  // Run a git action with pending state
  // -------------------------------------------------------------------------

  const runAction = useCallback(async (
    label: string,
    fn: () => Promise<GitActionResult | void>,
  ) => {
    setActionPending(label);
    setErrorMsg(null);
    try {
      const result = await fn();
      if (result && result.exitCode !== 0) {
        const msg = result.error ?? result.stderr ?? "Command failed";
        if (mountedRef.current) setErrorMsg(msg);
      }
    } catch (err) {
      if (mountedRef.current) setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setActionPending(null);
        await refreshAll();
      }
    }
  }, [refreshAll]);

  // -------------------------------------------------------------------------
  // Action button helper
  // -------------------------------------------------------------------------

  const busy = actionPending !== null;

  const ActionBtn = ({ label, pendingLabel, onClick, variant, size }: {
    label: string;
    pendingLabel?: string;
    onClick: () => void;
    variant?: "default" | "secondary";
    size?: "default" | "xs" | "sm";
  }) => {
    const isThis = actionPending === label;
    return (
      <Button
        onClick={onClick}
        disabled={busy}
        variant={variant ?? "default"}
        size={size ?? "xs"}
      >
        {isThis ? (pendingLabel ?? `${label}...`) : label}
      </Button>
    );
  };

  // -------------------------------------------------------------------------
  // Section header helper
  // -------------------------------------------------------------------------

  const SectionHeader = ({ id, title, count }: { id: string; title: string; count?: number }) => (
    <div
      onClick={() => toggleSection(id)}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2.5 cursor-pointer text-xs font-semibold text-foreground select-none",
        openSections[id] && "border-b border-border",
      )}
    >
      <span className="text-muted-foreground text-[10px]">{openSections[id] ? "\u25BC" : "\u25B6"}</span>
      {title}
      {count !== undefined && count > 0 && (
        <span className="text-blue text-[11px] font-normal">({count})</span>
      )}
    </div>
  );

  // -------------------------------------------------------------------------
  // Diff viewer
  // -------------------------------------------------------------------------

  const showDiff = async (filePath: string, staged: boolean) => {
    if (diffTarget === filePath) {
      setDiffContent(null);
      setDiffTarget(null);
      return;
    }
    setDiffTarget(filePath);
    try {
      // Use a different param name to avoid conflict with project path
      const result = await execGitAction<GitActionResult & { diff: string }>(
        projectPath, "diff", { staged, path: filePath },
      );
      if (mountedRef.current) setDiffContent(result.diff || "(no diff)");
    } catch {
      if (mountedRef.current) setDiffContent("(failed to load diff)");
    }
  };

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading && status === null) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Loading repository info...
      </div>
    );
  }

  const totalChanges = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);

  // -------------------------------------------------------------------------
  // Relative time helper
  // -------------------------------------------------------------------------

  const relTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  return (
    <div className="rounded-lg bg-mantle border border-border overflow-hidden">
      {/* Header — branch info + sync buttons */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="text-blue font-mono font-semibold">
            {status?.branch ?? "—"}
          </span>
          {status?.upstream && (
            <>
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground font-mono">{status.upstream}</span>
            </>
          )}
          {(status?.ahead ?? 0) > 0 && (
            <span className="text-green font-semibold">+{status!.ahead}</span>
          )}
          {(status?.behind ?? 0) > 0 && (
            <span className="text-peach font-semibold">-{status!.behind}</span>
          )}
          <span className={cn(
            "font-semibold text-[11px]",
            totalChanges === 0 ? "text-green" : "text-peach",
          )}>
            {totalChanges === 0 ? "clean" : `${totalChanges} change${totalChanges !== 1 ? "s" : ""}`}
          </span>
        </div>
        <div className="flex gap-1.5">
          <ActionBtn label="Fetch" pendingLabel="Fetching..." onClick={() => {
            void runAction("Fetch", () => execGitAction(projectPath, "fetch"));
          }} />
          <ActionBtn label="Pull" pendingLabel="Pulling..." onClick={() => {
            void runAction("Pull", () => execGitAction(projectPath, "pull"));
          }} />
          <ActionBtn label="Push" pendingLabel="Pushing..." onClick={() => {
            void runAction("Push", () => execGitAction(projectPath, "push"));
          }} />
        </div>
      </div>

      {/* Error banner */}
      {errorMsg !== null && (
        <div
          onClick={() => setErrorMsg(null)}
          className="px-3 py-2 bg-surface0 text-red text-[11px] cursor-pointer font-mono whitespace-pre-wrap break-words"
        >
          {errorMsg}
          <span className="float-right text-muted-foreground">(click to dismiss)</span>
        </div>
      )}

      {/* Changes section */}
      <div>
        <SectionHeader id="changes" title="Changes" count={totalChanges} />
        {openSections.changes && (
          <div className="px-3 py-2">
            {/* Staged */}
            {(status?.staged.length ?? 0) > 0 && (
              <div className="mb-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] font-semibold text-green">Staged</span>
                  <Button
                    variant="secondary"
                    size="xs"
                    className="bg-surface1"
                    disabled={busy}
                    onClick={() => {
                      void runAction("Unstage All", () =>
                        execGitAction(projectPath, "unstage", { paths: status!.staged.map((f) => f.path) }),
                      );
                    }}
                  >
                    Unstage All
                  </Button>
                </div>
                {status!.staged.map((f) => (
                  <FileRow
                    key={`s-${f.path}`} file={f} isStaged
                    onAction={() => {
                      void runAction(`unstage:${f.path}`, () =>
                        execGitAction(projectPath, "unstage", { paths: [f.path] }),
                      );
                    }}
                    onDiff={() => void showDiff(f.path, true)}
                    diffActive={diffTarget === f.path}
                    busy={busy}
                  />
                ))}
              </div>
            )}

            {/* Unstaged */}
            {(status?.unstaged.length ?? 0) > 0 && (
              <div className="mb-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] font-semibold text-peach">Unstaged</span>
                  <Button
                    variant="secondary"
                    size="xs"
                    className="bg-surface1"
                    disabled={busy}
                    onClick={() => {
                      void runAction("Stage All", () =>
                        execGitAction(projectPath, "stage", { paths: status!.unstaged.map((f) => f.path) }),
                      );
                    }}
                  >
                    Stage All
                  </Button>
                </div>
                {status!.unstaged.map((f) => (
                  <FileRow
                    key={`u-${f.path}`} file={f} isStaged={false}
                    onAction={() => {
                      void runAction(`stage:${f.path}`, () =>
                        execGitAction(projectPath, "stage", { paths: [f.path] }),
                      );
                    }}
                    onDiff={() => void showDiff(f.path, false)}
                    diffActive={diffTarget === f.path}
                    busy={busy}
                  />
                ))}
              </div>
            )}

            {/* Untracked */}
            {(status?.untracked.length ?? 0) > 0 && (
              <div className="mb-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Untracked</span>
                  <Button
                    variant="secondary"
                    size="xs"
                    className="bg-surface1"
                    disabled={busy}
                    onClick={() => {
                      void runAction("Stage Untracked", () =>
                        execGitAction(projectPath, "stage", { paths: status!.untracked }),
                      );
                    }}
                  >
                    Stage All
                  </Button>
                </div>
                {status!.untracked.map((fp) => (
                  <div key={`ut-${fp}`} className="flex items-center gap-2 py-0.5 text-[11px]">
                    <span className="text-muted-foreground font-mono text-[10px] w-3.5 text-center">?</span>
                    <span className="text-foreground font-mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{fp}</span>
                    <Button
                      variant="secondary"
                      size="xs"
                      className="bg-surface1"
                      disabled={busy}
                      onClick={() => {
                        void runAction(`stage:${fp}`, () =>
                          execGitAction(projectPath, "stage", { paths: [fp] }),
                        );
                      }}
                    >
                      stage
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {totalChanges === 0 && (
              <div className="text-[11px] text-muted-foreground py-1">Working tree clean</div>
            )}

            {/* Diff viewer */}
            {diffContent !== null && (
              <div className="mt-2 max-h-[300px] overflow-auto rounded-md border border-border bg-background">
                <pre className="m-0 p-2 text-[11px] font-mono whitespace-pre leading-[1.4]">
                  {diffContent.split("\n").map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        line.startsWith("+") && "text-green",
                        line.startsWith("-") && "text-red",
                        line.startsWith("@@") && "text-mauve",
                        !line.startsWith("+") && !line.startsWith("-") && !line.startsWith("@@") && "text-foreground",
                      )}
                    >
                      {line || " "}
                    </div>
                  ))}
                </pre>
              </div>
            )}

            {/* Commit input */}
            {(status?.staged.length ?? 0) > 0 && (
              <div className="flex gap-1.5 mt-2">
                <Input
                  type="text"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Commit message..."
                  className="flex-1 h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && commitMsg.trim() && !busy) {
                      void runAction("Commit", async () => {
                        const r = await execGitAction(projectPath, "commit", { message: commitMsg.trim() });
                        if (r.exitCode === 0) setCommitMsg("");
                        return r;
                      });
                    }
                  }}
                />
                <ActionBtn
                  label="Commit"
                  pendingLabel="Committing..."
                  onClick={() => {
                    if (!commitMsg.trim()) return;
                    void runAction("Commit", async () => {
                      const r = await execGitAction(projectPath, "commit", { message: commitMsg.trim() });
                      if (r.exitCode === 0) setCommitMsg("");
                      return r;
                    });
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stash section */}
      <div className="border-t border-border">
        <SectionHeader id="stash" title="Stash" count={stashes.length} />
        {openSections.stash && (
          <div className="px-3 py-2">
            {stashes.map((s) => (
              <div key={s.index} className="flex items-center gap-2 py-0.5 text-[11px]">
                <span className="text-blue font-mono text-[10px]">
                  @{"{" + s.index + "}"}
                </span>
                <span className="text-foreground flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {s.message}
                </span>
                <Button
                  variant="secondary"
                  size="xs"
                  className="bg-surface1"
                  disabled={busy}
                  onClick={() => {
                    void runAction(`stash_pop:${s.index}`, () =>
                      execGitAction(projectPath, "stash_pop", { index: s.index }),
                    );
                  }}
                >
                  Pop
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className="bg-surface1 text-red hover:text-red"
                  disabled={busy}
                  onClick={() => {
                    void runAction(`stash_drop:${s.index}`, () =>
                      execGitAction(projectPath, "stash_drop", { index: s.index }),
                    );
                  }}
                >
                  Drop
                </Button>
              </div>
            ))}
            {stashes.length === 0 && (
              <div className="text-[11px] text-muted-foreground py-0.5">No stashes</div>
            )}
            <div className="flex gap-1.5 mt-1.5">
              <Input
                type="text"
                value={stashMsg}
                onChange={(e) => setStashMsg(e.target.value)}
                placeholder="Stash message (optional)..."
                className="flex-1 h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) {
                    void runAction("Stash", async () => {
                      const r = await execGitAction(projectPath, "stash_save",
                        stashMsg.trim() ? { message: stashMsg.trim() } : {},
                      );
                      if (r.exitCode === 0) setStashMsg("");
                      return r;
                    });
                  }
                }}
              />
              <ActionBtn
                label="Stash"
                pendingLabel="Stashing..."
                size="xs"
                onClick={() => {
                  void runAction("Stash", async () => {
                    const r = await execGitAction(projectPath, "stash_save",
                      stashMsg.trim() ? { message: stashMsg.trim() } : {},
                    );
                    if (r.exitCode === 0) setStashMsg("");
                    return r;
                  });
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Branches section */}
      <div className="border-t border-border">
        <SectionHeader id="branches" title="Branches" count={branches.filter((b) => !b.name.startsWith("remotes/")).length} />
        {openSections.branches && (
          <div className="px-3 py-2">
            {branches.map((b) => (
              <div key={b.name} className="flex items-center gap-2 py-0.5 text-[11px]">
                <span className={cn(
                  "font-mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
                  b.current ? "text-blue font-semibold" : "text-foreground font-normal",
                )}>
                  {b.current ? "* " : "  "}{b.name}
                </span>
                <span className="text-muted-foreground font-mono text-[10px]">
                  {b.upstream ?? ""}
                </span>
                {!b.current && !b.name.startsWith("remotes/") && (
                  <>
                    <Button
                      variant="secondary"
                      size="xs"
                      className="bg-surface1"
                      disabled={busy}
                      onClick={() => {
                        void runAction(`checkout:${b.name}`, () =>
                          execGitAction(projectPath, "branch_checkout", { name: b.name }),
                        );
                      }}
                    >
                      Checkout
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      className="bg-surface1 text-red hover:text-red"
                      disabled={busy}
                      onClick={() => {
                        void runAction(`delete:${b.name}`, () =>
                          execGitAction(projectPath, "branch_delete", { name: b.name }),
                        );
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            ))}
            {branches.length === 0 && (
              <div className="text-[11px] text-muted-foreground py-0.5">No branches</div>
            )}
            <div className="flex gap-1.5 mt-1.5">
              <Input
                type="text"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder="New branch name..."
                className="flex-1 h-8 text-xs font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newBranch.trim() && !busy) {
                    void runAction("Create Branch", async () => {
                      const r = await execGitAction(projectPath, "branch_create", { name: newBranch.trim() });
                      if (r.exitCode === 0) setNewBranch("");
                      return r;
                    });
                  }
                }}
              />
              <ActionBtn
                label="Create"
                pendingLabel="Creating..."
                size="xs"
                onClick={() => {
                  if (!newBranch.trim()) return;
                  void runAction("Create Branch", async () => {
                    const r = await execGitAction(projectPath, "branch_create", { name: newBranch.trim() });
                    if (r.exitCode === 0) setNewBranch("");
                    return r;
                  });
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* History section */}
      <div className="border-t border-border">
        <SectionHeader id="history" title="History" count={commits.length} />
        {openSections.history && (
          <div className="px-3 py-2 max-h-[260px] overflow-y-auto">
            {commits.map((c) => (
              <div key={c.hash} className="flex items-baseline gap-2 py-0.5 text-[11px]">
                <span className="text-blue font-mono shrink-0 text-[10px]">
                  {c.hash}
                </span>
                <span className="text-foreground flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {c.message}
                </span>
                <span className="text-muted-foreground shrink-0 text-[10px]">{c.author}</span>
                <span className="text-muted-foreground shrink-0 text-[10px] min-w-[48px] text-right">
                  {c.date ? relTime(c.date) : ""}
                </span>
              </div>
            ))}
            {commits.length === 0 && (
              <div className="text-[11px] text-muted-foreground py-0.5">No commits</div>
            )}
          </div>
        )}
      </div>

      {/* Remotes section */}
      <div className="border-t border-border">
        <SectionHeader id="remotes" title="Remotes" count={remotes.length} />
        {openSections.remotes && (
          <div className="px-3 py-2">
            {remotes.map((r) => (
              <div key={r.name} className="flex items-center gap-2 py-0.5 text-[11px]">
                <span className="text-blue font-semibold font-mono">{r.name}</span>
                <span className="text-muted-foreground font-mono break-all flex-1">
                  {r.fetchUrl}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  className="text-red border-border hover:text-red shrink-0"
                  disabled={!!actionPending}
                  onClick={() => void runAction(`remote_remove:${r.name}`, async () => {
                    return execGitAction(projectPath, "remote_remove", { name: r.name });
                  })}
                >
                  Remove
                </Button>
              </div>
            ))}
            {remotes.length === 0 && (
              <div className="text-[11px] text-muted-foreground py-0.5">No remotes configured</div>
            )}
            {/* Add remote form */}
            <div className="flex gap-1.5 items-center mt-2">
              <Input
                type="text"
                value={newRemoteName}
                onChange={(e) => setNewRemoteName(e.target.value)}
                placeholder="name"
                className="w-20 h-8 text-xs font-mono"
              />
              <Input
                type="text"
                value={newRemoteUrl}
                onChange={(e) => setNewRemoteUrl(e.target.value)}
                placeholder="git@github.com:user/repo.git"
                className="flex-1 h-8 text-xs font-mono"
              />
              <Button
                size="xs"
                disabled={!!actionPending || !newRemoteName.trim() || !newRemoteUrl.trim()}
                className="shrink-0"
                onClick={() => {
                  if (!newRemoteName.trim() || !newRemoteUrl.trim()) return;
                  void runAction("remote_add", async () => {
                    const r = await execGitAction(projectPath, "remote_add", {
                      name: newRemoteName.trim(),
                      url: newRemoteUrl.trim(),
                    });
                    if (r.exitCode === 0) {
                      setNewRemoteName("origin");
                      setNewRemoteUrl("");
                    }
                    return r;
                  });
                }}
              >
                Add
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// FileRow sub-component
// ---------------------------------------------------------------------------

function FileRow({ file, isStaged, onAction, onDiff, diffActive, busy }: {
  file: GitFileEntry;
  isStaged: boolean;
  onAction: () => void;
  onDiff: () => void;
  diffActive: boolean;
  busy: boolean;
}) {
  const statusChar = {
    added: "A", modified: "M", deleted: "D", renamed: "R", copied: "C",
  }[file.status] ?? "?";
  const statusColorClass = {
    added: "text-green",
    modified: "text-blue",
    deleted: "text-red",
    renamed: "text-mauve",
    copied: "text-subtext0",
  }[file.status] ?? "text-muted-foreground";

  return (
    <div className="flex items-center gap-2 py-0.5 text-[11px]">
      <span className={cn("font-mono text-[10px] w-3.5 text-center font-semibold", statusColorClass)}>
        {statusChar}
      </span>
      <span className="text-foreground font-mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {file.path}
      </span>
      <Button
        variant="secondary"
        size="xs"
        className="bg-surface1"
        disabled={busy}
        onClick={onAction}
      >
        {isStaged ? "unstage" : "stage"}
      </Button>
      <Button
        variant="secondary"
        size="xs"
        className={cn(
          diffActive ? "bg-blue text-background hover:bg-blue/90" : "bg-surface1",
        )}
        disabled={busy}
        onClick={onDiff}
      >
        diff
      </Button>
    </div>
  );
}
