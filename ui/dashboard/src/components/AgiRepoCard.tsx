/**
 * AgiRepoCard — {project}.agi monorepo envelope control (Phase 3, first slice).
 *
 * Surfaces whether a project folder is a `{slug}.agi` git envelope and lets the
 * owner initialize it (or import an existing folder's repos/ as submodules).
 * The `.agi` suffix is a hard naming convention distinguishing the envelope
 * from the actual repos it contains.
 *
 * Not shown for the _aionima collection (excluded from the .agi model).
 */

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAgiRepoStatus, useAgiRepoAction } from "../hooks.js";

export function AgiRepoCard({ projectPath }: { projectPath: string }) {
  const { data, isLoading } = useAgiRepoStatus(projectPath);
  const action = useAgiRepoAction(projectPath);

  if (isLoading || !data) {
    return (
      <Card className="p-4" data-testid="agi-repo-card">
        <p className="text-sm text-muted-foreground">Checking .agi envelope…</p>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3" data-testid="agi-repo-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">.agi monorepo envelope</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Track this project folder as a <span className="font-mono">{"{slug}.agi"}</span> git repo with its{" "}
            <span className="font-mono">repos/</span> as submodules.
          </p>
        </div>
        <span
          className={
            data.initialized
              ? "text-[10px] px-2 py-0.5 rounded-full bg-green/10 text-green font-semibold shrink-0"
              : "text-[10px] px-2 py-0.5 rounded-full bg-surface1 text-muted-foreground font-semibold shrink-0"
          }
        >
          {data.initialized ? "✓ envelope" : "not initialized"}
        </span>
      </div>

      {action.isError && (
        <p className="text-[11px] text-red">{action.error instanceof Error ? action.error.message : "Action failed"}</p>
      )}

      {data.initialized ? (
        <div className="space-y-2">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Submodules ({data.submodules.length})
            </span>
            {data.submodules.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {data.submodules.map((p) => (
                  <li key={p} className="font-mono text-[11px] text-foreground">{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground italic mt-1">No submodules registered yet.</p>
            )}
          </div>
          {data.unregisteredRepos.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-amber/5 border border-amber/20 px-3 py-2">
              <p className="text-[11px] text-amber">
                {data.unregisteredRepos.length} repo(s) under <span className="font-mono">repos/</span> not yet
                registered as submodules.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="text-[11px] h-7 shrink-0"
                disabled={action.isPending}
                onClick={() => action.mutate("import")}
                data-testid="agi-repo-import"
              >
                {action.isPending ? "Registering…" : "Register"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            className="text-[11px] h-7"
            disabled={action.isPending}
            onClick={() => action.mutate("init")}
            data-testid="agi-repo-init"
          >
            {action.isPending ? "Initializing…" : "Initialize .agi repo"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7"
            disabled={action.isPending}
            onClick={() => action.mutate("import")}
            data-testid="agi-repo-import"
          >
            Import existing repos
          </Button>
        </div>
      )}
    </Card>
  );
}
