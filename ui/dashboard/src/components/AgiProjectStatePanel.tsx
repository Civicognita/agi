/**
 * AgiProjectStatePanel — Coordinate → Project (story #207).
 *
 * Manages a `{slug}.agi` envelope as a CONFIG / KNOWLEDGE-STATE surface — NOT a
 * repo manager. The envelope's git identity is its shared `project.json` config
 * + `.ai/` knowledge state + submodule pins; this panel detects upstream change,
 * shows a reviewable diff, and pulls/pushes that state. Chats (`.ai/chat/`),
 * sandbox and .trash are local-only and never sync.
 *
 * Includes the manual **upgrade Wizard** (git init + `{slug}.agi` remote) — the
 * remote step offers both: AGI auto-creates via the owner's GitHub token, OR the
 * owner pastes an existing remote URL.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  fetchAgiConfigState, initAgiRepo, configureAgiRemote, pullAgiState, pushAgiState,
} from "@/api.js";
import type { AgiConfigState, AgiConfigChange } from "@/types.js";

interface Props {
  projectPath: string;
  projectName: string;
}

const KIND_LABEL: Record<AgiConfigChange["kind"], string> = {
  config: "Config",
  knowledge: "Knowledge",
  submodule: "Submodule",
};

const CHANGE_GLYPH: Record<AgiConfigChange["change"], string> = {
  added: "+",
  modified: "~",
  deleted: "−",
};

function ChangeList({ title, changes }: { title: string; changes: AgiConfigChange[] }) {
  if (changes.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold text-muted-foreground mb-1">{title} ({changes.length})</div>
      <ul className="rounded-md border border-border bg-background divide-y divide-border">
        {changes.map((c) => (
          <li key={`${c.change}-${c.path}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono">
            <span className={c.change === "added" ? "text-green" : c.change === "deleted" ? "text-red" : "text-yellow"}>{CHANGE_GLYPH[c.change]}</span>
            <Badge variant="secondary" className="text-[9px] px-1 py-0">{KIND_LABEL[c.kind]}</Badge>
            <span className="truncate text-foreground">{c.path}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgiProjectStatePanel({ projectPath, projectName }: Props) {
  const [state, setState] = useState<AgiConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await fetchAgiConfigState(projectPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  if (loading && state === null) {
    return <div className="p-3 text-xs text-muted-foreground">Loading project state…</div>;
  }

  const slug = projectName.endsWith(".agi") ? projectName : `${projectName}.agi`;

  return (
    <Card className="bg-mantle">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Project config &amp; knowledge state
          {state?.initialized && <Badge variant="secondary" className="text-[9px]">.agi envelope</Badge>}
          {state?.hasRemote && <Badge variant="secondary" className="text-[9px]">remote</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs">
        {error && (
          <div className="rounded-md bg-red/10 border border-red/30 px-3 py-2 text-[12px] text-red mb-3">{error}</div>
        )}

        {/* Not yet a .agi envelope → manual upgrade. */}
        {!state?.initialized && (
          <div>
            <p className="text-muted-foreground leading-relaxed mb-3">
              This project isn&apos;t a <code className="text-blue">.agi</code> envelope yet. Upgrade it to
              track its shared <code>project.json</code> config and <code>.ai/</code> knowledge state in
              git — with a <code>{slug}</code> remote so Tynn / Genie can open the same envelope.
              Chats, memory, <code>sandbox/</code> and <code>.trash/</code> stay local.
            </p>
            <Button size="sm" onClick={() => setWizardOpen(true)} data-testid="agi-upgrade-start">
              Upgrade to .agi envelope…
            </Button>
          </div>
        )}

        {/* Initialized but no remote. */}
        {state?.initialized && !state.hasRemote && (
          <div>
            <p className="text-muted-foreground mb-3">
              Envelope is git-initialized but has no <code>{slug}</code> remote — config/knowledge state
              can&apos;t sync until one is set.
            </p>
            <Button size="sm" onClick={() => setWizardOpen(true)} data-testid="agi-set-remote">Set up the remote…</Button>
          </div>
        )}

        {/* Initialized + remote → the state surface. */}
        {state?.initialized && state.hasRemote && (
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-muted-foreground">Upstream:</span>
              <span className="font-mono text-foreground truncate">{state.remoteUrl}</span>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="text-[10px]">↑ {state.ahead} ahead</Badge>
              <Badge variant="secondary" className="text-[10px]">↓ {state.behind} behind</Badge>
              <span className="text-[10px] text-muted-foreground">chats &amp; memory excluded from sync</span>
            </div>

            <ChangeList title="Incoming (review before applying)" changes={state.incoming} />
            <ChangeList title="Local changes (not yet pushed)" changes={state.localChanges} />
            {state.incoming.length === 0 && state.localChanges.length === 0 && (
              <div className="text-[11px] text-muted-foreground py-2">Config &amp; knowledge state in sync.</div>
            )}

            <div className="flex gap-2 mt-3">
              <Button
                size="sm"
                disabled={busy !== null || state.behind === 0}
                onClick={() => void run("pull", () => pullAgiState(projectPath))}
                data-testid="agi-pull"
              >
                {busy === "pull" ? "Applying…" : "Pull & apply"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null || state.localChanges.length === 0}
                onClick={() => void run("push", () => pushAgiState(projectPath))}
                data-testid="agi-push"
              >
                {busy === "push" ? "Pushing…" : "Push state"}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void refresh()}>Refresh</Button>
            </div>
          </div>
        )}
      </CardContent>

      <UpgradeWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        projectPath={projectPath}
        slug={slug}
        alreadyInitialized={state?.initialized ?? false}
        onDone={() => { setWizardOpen(false); void refresh(); }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Upgrade Wizard (manual)
// ---------------------------------------------------------------------------

function UpgradeWizard({ open, onClose, projectPath, slug, alreadyInitialized, onDone }: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  slug: string;
  alreadyInitialized: boolean;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"init" | "remote">(alreadyInitialized ? "remote" : "init");
  const [remoteMode, setRemoteMode] = useState<"auto" | "url">("auto");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open) { setStep(alreadyInitialized ? "remote" : "init"); setErr(null); } }, [open, alreadyInitialized]);

  const doInit = async () => {
    setBusy(true); setErr(null);
    try {
      await initAgiRepo(projectPath);
      setStep("remote");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const doRemote = async () => {
    setBusy(true); setErr(null);
    try {
      await configureAgiRemote(projectPath, remoteMode, remoteMode === "url" ? remoteUrl : undefined);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="text-sm">Upgrade to a .agi envelope</DialogTitle>
          <DialogDescription className="text-xs">
            {step === "init"
              ? `Initialize ${slug} as a git envelope tracking config + knowledge state (chats stay local).`
              : "Set the remote so Tynn / Genie can open the same envelope."}
          </DialogDescription>
        </DialogHeader>

        {err && <div className="rounded-md bg-red/10 border border-red/30 px-3 py-2 text-[12px] text-red">{err}</div>}

        {step === "init" && (
          <div className="text-xs text-muted-foreground">
            Runs <code>git init</code> + an initial commit of <code>project.json</code> and{" "}
            <code>.ai/</code>. <code>sandbox/</code>, <code>.trash/</code>, <code>.ai/chat/</code> and{" "}
            <code>.ai/memory/</code> are gitignored.
          </div>
        )}

        {step === "remote" && (
          <div className="grid gap-3 text-xs">
            <div className="flex gap-2">
              <Button size="sm" variant={remoteMode === "auto" ? "default" : "secondary"} onClick={() => setRemoteMode("auto")} data-testid="agi-remote-auto">
                AGI creates {slug}
              </Button>
              <Button size="sm" variant={remoteMode === "url" ? "default" : "secondary"} onClick={() => setRemoteMode("url")} data-testid="agi-remote-url">
                Paste existing URL
              </Button>
            </div>
            {remoteMode === "auto" ? (
              <p className="text-muted-foreground">
                Creates a private <code>{slug}</code> on your connected GitHub account and wires{" "}
                <code>origin</code>. (Connect one in Settings → Gateway → Contributing if you haven&apos;t.)
              </p>
            ) : (
              <Input
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/you/your-slug.agi.git"
                className="h-8 font-mono"
                data-testid="agi-remote-url-input"
              />
            )}
          </div>
        )}

        <DialogFooter>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          {step === "init" ? (
            <Button size="sm" onClick={() => void doInit()} disabled={busy} data-testid="agi-wizard-init">
              {busy ? "Initializing…" : "Initialize"}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void doRemote()} disabled={busy || (remoteMode === "url" && remoteUrl.trim().length === 0)} data-testid="agi-wizard-finish">
              {busy ? "Working…" : "Finish"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
