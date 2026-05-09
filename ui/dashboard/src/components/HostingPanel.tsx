/**
 * HostingPanel — hosting configuration panel for expanded project cards.
 * Allows toggling hosting on/off, configuring type, hostname, docRoot, startCommand.
 * Dynamically renders hosting extension fields (e.g. runtime version selectors) from plugins.
 */

import { useCallback, useEffect, useState } from "react";
import { Callout } from "@particle-academy/react-fancy";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { isDesktopServedType } from "@/lib/project-type-classifier";
import type { ProjectHostingInfo, ProjectTypeTool, RuntimeInfo, StackInfo, ProjectStackInstance } from "../types.js";
import { fetchProjectDevCommands, fetchRuntimes, fetchProjectStacks, fetchStacks, fetchEffectiveStartCommand, resetCircuitBreaker } from "../api.js";
import type { EffectiveStartCommand } from "../api.js";
import { ProjectToolbar } from "./ProjectToolbar.js";
import { StackManager } from "./StackManager.js";
import { DatabaseCard } from "./DatabaseCard.js";
import { TerminalArea } from "./TerminalArea.js";

export interface HostingPanelProps {
  projectPath: string;
  hosting: ProjectHostingInfo;
  detectedHosting?: {
    projectType: string;
    suggestedStacks: string[];
    docRoot: string;
    startCommand: string | null;
  };
  infraReady: boolean;
  onConfigure: (params: {
    path: string;
    type?: string;
    hostname?: string;
    docRoot?: string;
    startCommand?: string;
    mode?: "production" | "development";
    internalPort?: number;
    runtimeId?: string;
    /**
     * @deprecated s150 t636 — UI no longer emits this; backend computes it
     * from `type`. Kept on the prop type for any caller still passing it.
     */
    containerKind?: "static" | "code" | "mapp";
    /** s145 t585 / s150 t636 — list of MApp IDs installed when type is Desktop-served. */
    mapps?: string[];
  }) => Promise<unknown>;
  onRestart: (path: string) => Promise<unknown>;
  onTunnelEnable?: (path: string) => Promise<unknown>;
  onTunnelDisable?: (path: string) => Promise<unknown>;
  busy: boolean;
  baseDomain?: string;
  tools?: ProjectTypeTool[];
  onToolExecute?: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  projectCategory?: string;
  /** Category-specific tab label (e.g., "Development", "Reader", "Gallery"). */
  tabLabel?: string;
  /** Available project types for the type dropdown. */
  availableTypes?: Array<{ id: string; label: string }>;
}

export function HostingPanel({
  projectPath,
  hosting,
  detectedHosting,
  infraReady,
  onConfigure,
  onRestart,
  onTunnelEnable,
  onTunnelDisable,
  busy,
  baseDomain = "ai.on",
  tools,
  onToolExecute,
  projectCategory,
  tabLabel = "Development",
  availableTypes,
}: HostingPanelProps) {
  const [type, setType] = useState<string>(hosting.type ?? detectedHosting?.projectType ?? "static-site");
  const [hostname, setHostname] = useState(hosting.hostname);
  const [docRoot, setDocRoot] = useState(hosting.docRoot ?? detectedHosting?.docRoot ?? "");
  // s150 t636 — Desktop-served vs code-served is derived from `type`.
  // Replaces the old `containerKind` selector. The mapps input renders only
  // when the project is Desktop-served; docRoot/startCommand render only
  // when it's code-served.
  const desktopServed = isDesktopServedType(type);
  const [mappsInput, setMappsInput] = useState<string>((hosting.mapps ?? []).join(", "));
  const [startCommand, setStartCommand] = useState(hosting.startCommand ?? detectedHosting?.startCommand ?? "");
  const [mode, setMode] = useState<"production" | "development">(hosting.mode ?? "production");
  const [internalPort, setInternalPort] = useState(
    hosting.internalPort !== null ? String(hosting.internalPort) : "",
  );
  const [saving, setSaving] = useState(false);
  const [resettingBreaker, setResettingBreaker] = useState(false);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelCopied, setTunnelCopied] = useState(false);
  const [devCommands, setDevCommands] = useState<Record<string, string>>({});
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [projectStackInstances, setProjectStackInstances] = useState<ProjectStackInstance[]>([]);
  const [stackDefs, setStackDefs] = useState<StackInfo[]>([]);
  const [stickyError, setStickyError] = useState<string | null>(null);
  const [logRefreshKey, setLogRefreshKey] = useState(0);
  const [dbRestartNeeded, setDbRestartNeeded] = useState(false);

  // Sync state when hosting prop changes
  useEffect(() => {
    // s150 t636 — track only the rerender values that survive the migration.
    setType(hosting.type ?? detectedHosting?.projectType ?? "static-site");
    setHostname(hosting.hostname);
    setDocRoot(hosting.docRoot ?? detectedHosting?.docRoot ?? "");
    setStartCommand(hosting.startCommand ?? detectedHosting?.startCommand ?? "");
    setMode(hosting.mode ?? "production");
    setInternalPort(hosting.internalPort !== null ? String(hosting.internalPort) : "");
    setMappsInput((hosting.mapps ?? []).join(", "));
  }, [hosting, detectedHosting]);

  // Track errors: capture from hosting prop, clear only when status becomes "running"
  useEffect(() => {
    if (hosting.error) {
      setStickyError(hosting.error);
    } else if (hosting.status === "running") {
      setStickyError(null);
    }
  }, [hosting.error, hosting.status]);

  // Fetch aggregated dev commands from installed stacks
  useEffect(() => {
    fetchProjectDevCommands(projectPath).then(setDevCommands).catch(() => setDevCommands({}));
  }, [projectPath]);

  // Fetch effective start command (what will actually run at boot, and why)
  const [effectiveStart, setEffectiveStart] = useState<EffectiveStartCommand | null>(null);
  useEffect(() => {
    fetchEffectiveStartCommand(projectPath).then(setEffectiveStart).catch(() => setEffectiveStart(null));
  }, [projectPath, startCommand, hosting.status]);

  // Fetch available runtimes
  useEffect(() => {
    fetchRuntimes().then(setRuntimes).catch(() => setRuntimes([]));
  }, []);

  // Fetch project stacks and stack definitions for compatible-language filtering
  useEffect(() => {
    fetchProjectStacks(projectPath).then(setProjectStackInstances).catch(() => setProjectStackInstances([]));
    fetchStacks().then(setStackDefs).catch(() => setStackDefs([]));
  }, [projectPath]);

  const handleSaveConfig = useCallback(async () => {
    setSaving(true);
    try {
      const portNum = internalPort ? Number(internalPort) : undefined;
      // s150 t636 — Desktop-served projects emit mapps[]; code-served emit
      // docRoot/startCommand. Empty input on Desktop-served clears mapps[].
      const parsedMapps = desktopServed
        ? Array.from(new Set(mappsInput.split(",").map((s) => s.trim()).filter((s) => s.length > 0)))
        : undefined;
      await onConfigure({
        path: projectPath,
        type,
        hostname: hostname || undefined,
        // s150 t636 — only emit code-served fields for code-served projects.
        // Desktop-served projects ignore docRoot/startCommand at dispatch
        // (post-t634); sending stale values would just clutter project.json.
        ...(desktopServed
          ? {}
          : {
              docRoot: docRoot || undefined,
              // Intentionally send empty string when the user clears the field —
              // server treats empty as "clear the override". `startCommand || undefined`
              // would collapse it to "don't update".
              startCommand,
            }),
        mode,
        internalPort: portNum && !isNaN(portNum) ? portNum : undefined,
        mapps: parsedMapps,
      });
    } catch { /* error handled by caller */ } finally {
      setSaving(false);
    }
  }, [projectPath, type, hostname, docRoot, startCommand, mode, internalPort, desktopServed, mappsInput, onConfigure]);

  // Derive the set of compatible languages from installed stacks.
  // If any installed stack declares compatibleLanguages, restrict the runtime
  // dropdown to those languages. If none declare it, show all runtimes.
  const compatibleLanguages = new Set<string>();
  for (const instance of projectStackInstances) {
    const def = stackDefs.find((d) => d.id === instance.stackId);
    if (def?.compatibleLanguages) {
      for (const lang of def.compatibleLanguages) {
        compatibleLanguages.add(lang);
      }
    }
  }
  const visibleRuntimes = compatibleLanguages.size > 0
    ? runtimes.filter((r) => compatibleLanguages.has(r.language))
    : runtimes;

  // "needs-build" is a soft-error sub-state surfaced by the gateway's
  // pre-flight when a stack-driven project lacks a built dist/ on disk.
  // It's not a runtime failure — it's an owner-action waiting state, so
  // render it as amber/yellow rather than red.
  const needsBuild = hosting.status === "error"
    && (stickyError?.startsWith("Build output missing") ?? false);

  const statusColor = needsBuild
    ? "text-yellow"
    : {
        running: "text-green",
        stopped: "text-muted-foreground",
        error: "text-red",
        unconfigured: "text-muted-foreground",
      }[hosting.status];

  const statusDot = needsBuild
    ? "bg-yellow"
    : {
        running: "bg-green",
        stopped: "bg-muted-foreground",
        error: "bg-red",
        unconfigured: "bg-muted-foreground",
      }[hosting.status];

  const statusLabel = needsBuild ? "needs build" : hosting.status;

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] font-semibold text-card-foreground">
          {tabLabel}
        </div>
      </div>

      {!infraReady && (
        <div className="text-[11px] text-yellow mb-2">
          Hosting infrastructure not configured. Run setup first.
        </div>
      )}

      {/* Container status + actions — at the top */}
      <div className="mb-3 pb-2 border-b border-border">
        {stickyError && (
          <Callout color={needsBuild ? "amber" : "red"} className="px-3 py-2 mb-2">
            <div className="flex items-center justify-between mb-0.5">
              <span className={cn("text-[11px] font-semibold", needsBuild ? "text-yellow" : "text-red")}>
                {needsBuild ? "Needs Build" : "Container Error"}
              </span>
              <button onClick={() => setStickyError(null)} className={cn("text-[10px]", needsBuild ? "text-yellow/60 hover:text-yellow" : "text-red/60 hover:text-red")}>Dismiss</button>
            </div>
            <div className={cn("text-[11px] whitespace-pre-wrap break-words", needsBuild ? "text-yellow/80" : "text-red/80")}>{stickyError}</div>
          </Callout>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("inline-block w-2 h-2 rounded-full", statusDot)} />
            <span className={cn("text-[12px] font-semibold capitalize", statusColor)}>{statusLabel}</span>
            {hosting.breaker && hosting.breaker.status !== "closed" && (
              <>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium",
                    hosting.breaker.status === "open"
                      ? "bg-red/15 text-red"
                      : "bg-amber/15 text-amber",
                  )}
                  title={hosting.breaker.lastError ?? `${String(hosting.breaker.failures)} consecutive failures`}
                >
                  {hosting.breaker.status === "open"
                    ? `circuit open · ${String(hosting.breaker.failures)} fails`
                    : "circuit half-open"}
                </span>
                <button
                  onClick={() => {
                    setResettingBreaker(true);
                    resetCircuitBreaker(`hosting:${projectPath}`)
                      .then(() => onRestart(projectPath))
                      .catch((err: unknown) => setStickyError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setResettingBreaker(false));
                  }}
                  disabled={resettingBreaker || busy}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Reset the circuit breaker and re-attempt boot"
                >
                  {resettingBreaker ? "resetting…" : "reset"}
                </button>
              </>
            )}
            {hosting.url && (
              <a href={hosting.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue underline">{hosting.url}</a>
            )}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => { void onRestart(projectPath).catch((err: unknown) => { setStickyError(err instanceof Error ? err.message : String(err)); }); }} disabled={busy} className="text-[11px] h-7">Restart</Button>
            <Button size="sm" onClick={() => void handleSaveConfig()} disabled={saving || busy} className="text-[11px] h-7">{saving ? "Saving..." : "Save Config"}</Button>
          </div>
        </div>
        {(hosting.containerName || hosting.image) && (
          <div className="flex gap-3 mt-1.5 text-[11px] text-muted-foreground">
            {hosting.containerName && <span>Container: <code className="text-foreground">{hosting.containerName}</code></span>}
            {hosting.image && <span>Image: <code className="text-foreground">{hosting.image}</code></span>}
          </div>
        )}
      </div>

      {/* Config fields */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
            Project Type
          </label>
          <Select
            className="text-[12px]"
            list={availableTypes && availableTypes.length > 0
              ? availableTypes.map((pt) => ({ value: pt.id, label: pt.label }))
              : [{ value: type, label: type.replace(/-/g, " ") }]
            }
            value={type}
            onValueChange={setType}
          />
        </div>
        {visibleRuntimes.length > 0 && (
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
              Runtime
            </label>
            <Select
              className="text-[12px]"
              list={[
                { value: "", label: "Default" },
                ...visibleRuntimes.filter((r) => r.installed).map((r) => ({ value: r.id, label: r.label })),
              ]}
              value={hosting.runtimeId ?? ""}
              onValueChange={(v) => {
                void onConfigure({
                  path: projectPath,
                  runtimeId: v || undefined,
                });
              }}
              disabled={busy}
            />
          </div>
        )}
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
            Hostname
          </label>
          <div className="flex items-center gap-1">
            <Input
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              disabled={busy}
              className="text-[12px] h-8"
            />
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">.{baseDomain}</span>
          </div>
        </div>
        {/*
          s150 t636 — Container Kind select REMOVED. The container shape is
          now derived from `type` via the type registry (DESKTOP_SERVED_TYPES
          vs CODE_SERVED_TYPES). The MApps input below renders only for
          Desktop-served types.
        */}
        {desktopServed && (
          <div className="col-span-2" data-testid="hosting-mapps-row">
            <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
              MApps <span className="font-normal italic opacity-70">(comma-separated IDs from MApp Marketplace)</span>
            </label>
            <Input
              type="text"
              value={mappsInput}
              onChange={(e) => setMappsInput(e.target.value)}
              disabled={busy}
              placeholder="budget-tracker, whitepaper-canvas, prime-explorer"
              className="text-[12px] h-8"
              data-testid="hosting-mapps-input"
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground leading-tight">
              Desktop-served project — listed MApps render as tiles on the project's Desktop.
            </p>
          </div>
        )}
      </div>

      {/* s150 t636 \u2014 docRoot + startCommand only render for code-served projects.
          Desktop-served projects ignore both fields at dispatch (post-t634);
          rendering them just wastes attention and invites stale config. */}
      {!desktopServed && (
        <div className="grid grid-cols-2 gap-2 mb-2" data-testid="hosting-code-served-fields">
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
              Doc Root
            </label>
            <Input
              type="text"
              value={docRoot}
              onChange={(e) => setDocRoot(e.target.value)}
              disabled={busy}
              placeholder="dist"
              className="text-[12px] h-8"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
              Start Command <span className="font-normal italic opacity-70">(override)</span>
            </label>
            <Input
              type="text"
              value={startCommand}
              onChange={(e) => setStartCommand(e.target.value)}
              disabled={busy}
              placeholder={effectiveStart?.stackDefault ?? "npm start"}
              className="text-[12px] h-8"
              data-testid="hosting-start-command-input"
            />
            <div className="mt-0.5 text-[10px] text-muted-foreground leading-tight">
              {effectiveStart !== null && (
                <>
                  <span data-testid="hosting-start-command-source" className={cn(
                    effectiveStart.source === "override" && "text-blue font-semibold",
                  )}>
                    {effectiveStart.source === "override" && "Using your override."}
                    {effectiveStart.source === "stack" && "Using stack default."}
                    {effectiveStart.source === "devCommands" && "Using stack devCommands fallback."}
                    {effectiveStart.source === "image-default" && "No command \u2014 image default CMD runs."}
                  </span>
                  {effectiveStart.source !== "override" && effectiveStart.stackDefault && (
                    <>
                      {" "}
                      <span className="opacity-70">Leave empty to keep default: </span>
                      <code className="text-[10px]">{effectiveStart.stackDefault}</code>
                    </>
                  )}
                  {effectiveStart.source === "override" && effectiveStart.stackDefault && (
                    <>
                      {" "}
                      <span className="opacity-70">Stack default (cleared by override): </span>
                      <code className="text-[10px]">{effectiveStart.stackDefault}</code>
                    </>
                  )}
                </>
              )}
              {effectiveStart === null && (
                <span className="opacity-70">Leave empty to use your installed stack&apos;s default; when set, this replaces the stack command and runs via sh -c.</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
            Mode
          </label>
          <Select
            className="text-[12px]"
            list={[
              { value: "production", label: "Production" },
              { value: "development", label: "Development" },
            ]}
            value={mode}
            onValueChange={(v) => setMode(v as "production" | "development")}
            disabled={busy}
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
            Internal Port
          </label>
          <Input
            type="text"
            value={internalPort}
            onChange={(e) => setInternalPort(e.target.value)}
            disabled={busy}
            placeholder="3000"
            className="text-[12px] h-8"
          />
        </div>
      </div>

      {/* Database */}
      <div className="mb-3 pt-2 border-t border-border">
        {dbRestartNeeded && (
          <div className="mb-2 text-[11px] text-yellow">
            Database changed — restart the container to apply.
          </div>
        )}
        <DatabaseCard
          projectPath={projectPath}
          installedStacks={projectStackInstances}
          stackDefs={stackDefs}
          onStackChange={() => {
            fetchProjectStacks(projectPath).then(setProjectStackInstances).catch(() => {});
            fetchStacks().then(setStackDefs).catch(() => {});
          }}
          onRestartNeeded={() => setDbRestartNeeded(true)}
        />
      </div>

      {/* Stack Manager */}
      <div className="mb-3 pt-2 border-t border-border">
        <StackManager
          projectPath={projectPath}
          projectCategory={projectCategory}
          suggestedStacks={detectedHosting?.suggestedStacks}
          onToolExecute={onToolExecute}
        />
      </div>

      {/* Public tunnel */}
      {hosting.status === "running" && onTunnelEnable && onTunnelDisable && (
        <div className="mb-3 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold text-muted-foreground">Public Tunnel</div>
            {hosting.tunnelUrl ? (
              <Button size="sm" variant="outline" onClick={() => { setTunnelLoading(true); void onTunnelDisable(projectPath).finally(() => setTunnelLoading(false)); }} disabled={tunnelLoading || busy} className="text-[11px] h-7 text-red">Stop Tunnel</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => { setTunnelLoading(true); void onTunnelEnable(projectPath).finally(() => setTunnelLoading(false)); }} disabled={tunnelLoading || busy} className="text-[11px] h-7">{tunnelLoading ? "Starting..." : "Share"}</Button>
            )}
          </div>
          {hosting.tunnelUrl && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <a href={hosting.tunnelUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-green underline truncate">{hosting.tunnelUrl}</a>
              <button onClick={() => { void navigator.clipboard.writeText(hosting.tunnelUrl!); setTunnelCopied(true); setTimeout(() => setTunnelCopied(false), 2000); }} className="text-[10px] text-muted-foreground hover:text-foreground shrink-0" title="Copy URL">{tunnelCopied ? "Copied!" : "Copy"}</button>
            </div>
          )}
        </div>
      )}

      {/* Dev Commands — above logs */}
      {Object.keys(devCommands).length > 0 && onToolExecute && (
        <div className="mb-3 pt-2 border-t border-border">
          <div className="text-[10px] font-semibold text-muted-foreground mb-1.5">Dev Commands</div>
          <ProjectToolbar tools={Object.entries(devCommands).map(([key, cmd]) => ({ id: `dev-cmd-${key}`, label: key, description: cmd, action: "shell" as const, command: cmd }))} projectPath={projectPath} onExecute={onToolExecute} onToolComplete={() => setLogRefreshKey((k) => k + 1)} compact />
        </div>
      )}

      {/* Stack tools */}
      {tools && tools.length > 0 && onToolExecute && (
        <div className="mb-3 pt-2 border-t border-border">
          <div className="text-[10px] font-semibold text-muted-foreground mb-1.5">Tools</div>
          <ProjectToolbar tools={tools} projectPath={projectPath} onExecute={onToolExecute} onToolComplete={() => setLogRefreshKey((k) => k + 1)} compact />
        </div>
      )}

      {/* Logs + Terminal */}
      <div className="pt-2 border-t border-border">
        <TerminalArea projectPath={projectPath} refreshKey={logRefreshKey} />
      </div>
    </Card>
  );
}
