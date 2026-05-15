/**
 * AionimaSystemReposPanel — s179
 *
 * Repos tab content for the _aionima meta-project (type "aionima-system").
 * Shows all five core forks with ahead/behind status, a file browser toggle,
 * and a "Talk to project" button that opens Aion chat scoped to _aionima.
 */

import { useCallback, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useCoreForkStatus } from "../hooks.js";
import { fetchProjectFileTree } from "../api.js";
import type { FileNode } from "../api.js";

const FORK_LABELS: Record<string, string> = {
  agi: "AGI — gateway",
  prime: "PRIME — corpus",
  id: "Local-ID",
  marketplace: "Plugin Marketplace",
  "mapp-marketplace": "MApp Marketplace",
};

export interface AionimaSystemReposPanelProps {
  projectPath: string;
  onOpenChat: () => void;
}

export function AionimaSystemReposPanel({
  projectPath,
  onOpenChat,
}: AionimaSystemReposPanelProps) {
  const { data, isLoading, refetch } = useCoreForkStatus();

  const [showFiles, setShowFiles] = useState(false);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [fileTreeLoading, setFileTreeLoading] = useState(false);

  const handleFileBrowserToggle = useCallback(async () => {
    const next = !showFiles;
    setShowFiles(next);
    if (next && fileTree.length === 0) {
      setFileTreeLoading(true);
      try {
        const tree = await fetchProjectFileTree(projectPath, false);
        setFileTree(tree);
      } catch {
        // leave fileTree empty
      } finally {
        setFileTreeLoading(false);
      }
    }
  }, [showFiles, fileTree.length, projectPath]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Core Forks</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7"
            onClick={handleFileBrowserToggle}
            data-testid="aionima-repos-toggle-files"
          >
            {showFiles ? "Hide files" : "Show files"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7"
            onClick={() => void refetch()}
            data-testid="aionima-repos-refresh"
          >
            Refresh
          </Button>
          <Button
            size="sm"
            className="text-[11px] h-7"
            onClick={onOpenChat}
            data-testid="aionima-repos-talk"
          >
            Talk to project
          </Button>
        </div>
      </div>

      {/* Fork status list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading fork status…</p>
      ) : !data?.forks.length ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground italic">
            No forks provisioned. Enable Contributing Mode in{" "}
            <Link to="/settings/gateway" className="underline">
              Settings → Gateway → Contributing
            </Link>{" "}
            to clone the core repos.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.forks.map((fork) => (
            <Card
              key={fork.slug}
              className="p-3 flex items-center gap-3"
              data-testid={`aionima-fork-row-${fork.slug}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground leading-tight">
                  {FORK_LABELS[fork.slug] ?? fork.displayName}
                </p>
                <p className="text-[11px] text-muted-foreground font-mono">
                  {fork.slug} · {fork.branch}
                </p>
              </div>

              {/* ahead/behind badges */}
              <div className="flex items-center gap-2 shrink-0">
                {fork.error ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
                    error
                  </span>
                ) : fork.ahead === 0 && fork.behind === 0 ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                    ✓ up to date
                  </span>
                ) : (
                  <>
                    {fork.ahead > 0 && (
                      <span
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full font-medium",
                          "bg-emerald-500/15 text-emerald-400",
                        )}
                        title={`${fork.ahead} commit(s) ahead of upstream`}
                      >
                        ↑{fork.ahead}
                      </span>
                    )}
                    {fork.behind > 0 && (
                      <span
                        className={cn(
                          "text-[11px] px-2 py-0.5 rounded-full font-medium",
                          "bg-amber-500/15 text-amber-400",
                        )}
                        title={`${fork.behind} commit(s) behind upstream`}
                      >
                        ↓{fork.behind}
                      </span>
                    )}
                  </>
                )}

                <Link
                  to={`/projects/${fork.slug}`}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors no-underline"
                  data-testid={`aionima-fork-open-${fork.slug}`}
                >
                  Open →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* File browser (toggled) */}
      {showFiles && (
        <Card className="p-3" data-testid="aionima-repos-file-browser">
          <p className="text-[11px] font-semibold text-muted-foreground mb-2">
            Files — {projectPath}
          </p>
          {fileTreeLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : fileTree.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No files found</p>
          ) : (
            <ul className="font-mono text-[11px] space-y-0.5 max-h-60 overflow-y-auto">
              {fileTree.slice(0, 50).map((node) => (
                <li key={node.path} className="text-muted-foreground/80">
                  {node.type === "dir" ? "▸" : " "} {node.name}
                </li>
              ))}
              {fileTree.length > 50 && (
                <li className="text-muted-foreground/50 italic">
                  … and {fileTree.length - 50} more. Use the Editor tab for full browsing.
                </li>
              )}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
