/**
 * HostingPanel — hosting configuration panel for expanded project cards.
 * Allows toggling hosting on/off, configuring type, hostname, docRoot, startCommand.
 * Dynamically renders hosting extension fields (e.g. runtime version selectors) from plugins.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectHostingInfo, ProjectTypeTool, RuntimeInfo, StackInfo, ProjectStackInstance } from "../types.js";
import { fetchProjectDevCommands, fetchRuntimes, fetchProjectStacks, fetchStacks } from "../api.js";
import { ProjectToolbar } from "./ProjectToolbar.js";
import { StackManager } from "./StackManager.js";
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
  const [startCommand, setStartCommand] = useState(hosting.startCommand ?? detectedHosting?.startCommand ?? "");
  const [mode, setMode] = useState<"production" | "development">(hosting.mode ?? "production");
  const [internalPort, setInternalPort] = useState(
    hosting.internalPort !== null ? String(hosting.internalPort) : "",
  );
  const [saving, setSaving] = useState(false);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelCopied, setTunnelCopied] = useState(false);
  const [devCommands, setDevCommands] = useState<Record<string, string>>({});
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [projectStackInstances, setProjectStackInstances] = useState<ProjectStackInstance[]>([]);
  const [stackDefs, setStackDefs] = useState<StackInfo[]>([]);
  const [stickyError, setStickyError] = useState<string | null>(null);
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  // Sync state when hosting prop changes
  useEffect(() => {
    setType(hosting.type ?? detectedHosting?.projectType ?? "static-site");
    setHostname(hosting.hostname);
    setDocRoot(hosting.docRoot ?? detectedHosting?.docRoot ?? "");
    setStartCommand(hosting.startCommand ?? detectedHosting?.startCommand ?? "");
    setMode(hosting.mode ?? "production");
    setInternalPort(hosting.internalPort !== null ? String(hosting.internalPort) : "");
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
      await onConfigure({
        path: projectPath,
        type,
        hostname: hostname || undefined,
        docRoot: docRoot || undefined,
        startCommand: startCommand || undefined,
        mode,
        internalPort: portNum && !isNaN(portNum) ? portNum : undefined,
      });
    } catch { /* error handled by caller */ } finally {
      setSaving(false);
    }
  }, [projectPath, type, hostname, docRoot, startCommand, mode, internalPort, onConfigure]);

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

  const statusColor = {
    running: "text-green",
    stopped: "text-muted-foreground",
    error: "text-red",
    unconfigured: "text-muted-foreground",
  }[hosting.status];

  const statusDot = {
    running: "bg-green",
    stopped: "bg-muted-foreground",
    error: "bg-red",
    unconfigured: "bg-muted-foreground",
  }[hosting.status];

  return (
    <div className="p-3 rounded-lg border border-border bg-mantle">
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

      {/* Config fields */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
            Project Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full h-8 px-2 rounded-md border border-border bg-background text-foreground text-[12px]"
          >
            {availableTypes && availableTypes.length > 0
              ? availableTypes.map((pt) => (
                  <option key={pt.id} value={pt.id}>{pt.label}</option>
                ))
              : <option value={type}>{type.replace(/-/g, " ")}</option>
            }
          </select>
        </div>
        {visibleRuntimes.length > 0 && (
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
              Runtime
            </label>
            <select
              value={hosting.runtimeId ?? ""}
              onChange={(e) => {
                const val = e.target.value || undefined;
                void onConfigure({
                  path: projectPath,
                  runtimeId: val,
                });
              }}
              disabled={busy}
              className="w-full h-8 px-2 rounded-md border border-border bg-background text-foreground text-[12px] disabled:opacity-50"
            >
              <option value="">Default</option>
              {visibleRuntimes.filter((r) => r.installed).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
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
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
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
            Start Command
          </label>
          <Input
            type="text"
            value={startCommand}
            onChange={(e) => setStartCommand(e.target.value)}
            disabled={busy}
            placeholder="npm start"
            className="text-[12px] h-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground mb-0.5">
            Mode
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "production" | "development")}
            disabled={busy}
            className="w-full h-8 px-2 rounded-md border border-border bg-background text-foreground text-[12px] disabled:opacity-50"
          >
            <option value="production">Production</option>
            <option value="development">Development</option>
          </select>
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

      {/* Stack Manager — always visible so stacks can be configured before enabling hosting */}
      <div className="mb-3 pt-2 border-t border-border">
        <StackManager
          projectPath={projectPath}
          projectCategory={projectCategory}
          suggestedStacks={detectedHosting?.suggestedStacks}
          onToolExecute={onToolExecute}
        />
      </div>

      {/* Status + actions — always visible (all projects are auto-hosted) */}
        <div className="mt-3 pt-2 border-t border-border">
          {/* Error banner — sticky until status becomes running or dismissed */}
          {stickyError && (
            <div className="rounded-lg bg-red/10 border border-red/30 px-3 py-2 mb-2">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-semibold text-red">Container Error</span>
                <button
                  onClick={() => setStickyError(null)}
                  className="text-[10px] text-red/60 hover:text-red"
                >
                  Dismiss
                </button>
              </div>
              <div className="text-[11px] text-red/80 whitespace-pre-wrap break-words">{stickyError}</div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn("inline-block w-2 h-2 rounded-full", statusDot)} />
              <span className={cn("text-[12px] font-semibold capitalize", statusColor)}>
                {hosting.status}
              </span>
              {hosting.url && (
                <a
                  href={hosting.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue underline"
                >
                  {hosting.url}
                </a>
              )}
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void onRestart(projectPath).catch((err: unknown) => {
                    setStickyError(err instanceof Error ? err.message : String(err));
                  });
                }}
                disabled={busy}
                className="text-[11px] h-7"
              >
                Restart
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSaveConfig()}
                disabled={saving || busy}
                className="text-[11px] h-7"
              >
                {saving ? "Saving..." : "Save Config"}
              </Button>
            </div>
          </div>
          {/* Container info */}
          {(hosting.containerName || hosting.image) && (
            <div className="flex gap-3 mt-1.5 text-[11px] text-muted-foreground">
              {hosting.containerName && (
                <span>Container: <code className="text-foreground">{hosting.containerName}</code></span>
              )}
              {hosting.image && (
                <span>Image: <code className="text-foreground">{hosting.image}</code></span>
              )}
            </div>
          )}

          {/* Public tunnel */}
          {hosting.status === "running" && onTunnelEnable && onTunnelDisable && (
            <div className="mt-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold text-muted-foreground">Public Tunnel</div>
                {hosting.tunnelUrl ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTunnelLoading(true);
                      void onTunnelDisable(projectPath).finally(() => setTunnelLoading(false));
                    }}
                    disabled={tunnelLoading || busy}
                    className="text-[11px] h-7 text-red"
                  >
                    Stop Tunnel
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTunnelLoading(true);
                      void onTunnelEnable(projectPath).finally(() => setTunnelLoading(false));
                    }}
                    disabled={tunnelLoading || busy}
                    className="text-[11px] h-7"
                  >
                    {tunnelLoading ? "Starting..." : "Share"}
                  </Button>
                )}
              </div>
              {hosting.tunnelUrl && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <a
                    href={hosting.tunnelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-green underline truncate"
                  >
                    {hosting.tunnelUrl}
                  </a>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(hosting.tunnelUrl!);
                      setTunnelCopied(true);
                      setTimeout(() => setTunnelCopied(false), 2000);
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                    title="Copy URL"
                  >
                    {tunnelCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Stack dev commands — above logs */}
          {Object.keys(devCommands).length > 0 && onToolExecute && (
            <div className="mt-3 pt-2 border-t border-border">
              <div className="text-[10px] font-semibold text-muted-foreground mb-1.5">Dev Commands</div>
              <ProjectToolbar
                tools={Object.entries(devCommands).map(([key, cmd]) => ({
                  id: `dev-cmd-${key}`,
                  label: key,
                  description: cmd,
                  action: "shell" as const,
                  command: cmd,
                }))}
                projectPath={projectPath}
                onExecute={onToolExecute}
                onToolComplete={() => setLogRefreshKey((k) => k + 1)}
                compact
              />
            </div>
          )}

          {/* Stack tools */}
          {tools && tools.length > 0 && onToolExecute && (
            <div className="mt-3 pt-2 border-t border-border">
              <div className="text-[10px] font-semibold text-muted-foreground mb-1.5">Tools</div>
              <ProjectToolbar
                tools={tools}
                projectPath={projectPath}
                onExecute={onToolExecute}
                onToolComplete={() => setLogRefreshKey((k) => k + 1)}
                compact
              />
            </div>
          )}

          {/* Project Logs + Container Terminal */}
          <div className="mt-3 pt-2 border-t border-border">
            <TerminalArea projectPath={projectPath} refreshKey={logRefreshKey} />
          </div>
        </div>
    </div>
  );
}
