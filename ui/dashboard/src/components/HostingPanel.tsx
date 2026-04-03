/**
 * HostingPanel — hosting configuration panel for expanded project cards.
 * Allows toggling hosting on/off, configuring type, hostname, docRoot, startCommand.
 * Dynamically renders hosting extension fields (e.g. runtime version selectors) from plugins.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectHostingInfo, ProjectTypeTool, RuntimeInfo } from "../types.js";
import { fetchProjectDevCommands, fetchRuntimes } from "../api.js";
import { ProjectToolbar } from "./ProjectToolbar.js";
import { StackManager } from "./StackManager.js";
import { EnvManager } from "./EnvManager.js";
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
  onEnable: (params: {
    path: string;
    type?: string;
    hostname?: string;
    docRoot?: string;
    startCommand?: string;
    mode?: "production" | "development";
    internalPort?: number;
    runtimeId?: string;
  }) => Promise<unknown>;
  onDisable: (path: string) => Promise<unknown>;
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
}

export function HostingPanel({
  projectPath,
  hosting,
  detectedHosting,
  infraReady,
  onEnable,
  onDisable,
  onConfigure,
  onRestart,
  onTunnelEnable,
  onTunnelDisable,
  busy,
  baseDomain = "ai.on",
  tools,
  onToolExecute,
  projectCategory,
}: HostingPanelProps) {
  const [type, setType] = useState<string>(
    hosting.enabled ? hosting.type : (detectedHosting?.projectType ?? hosting.type),
  );
  const [hostname, setHostname] = useState(hosting.hostname);
  const [docRoot, setDocRoot] = useState(
    hosting.enabled ? (hosting.docRoot ?? "") : (detectedHosting?.docRoot ?? hosting.docRoot ?? ""),
  );
  const [startCommand, setStartCommand] = useState(
    hosting.enabled ? (hosting.startCommand ?? "") : (detectedHosting?.startCommand ?? hosting.startCommand ?? ""),
  );
  const [mode, setMode] = useState<"production" | "development">(hosting.mode ?? "production");
  const [internalPort, setInternalPort] = useState(
    hosting.internalPort !== null ? String(hosting.internalPort) : "",
  );
  const [saving, setSaving] = useState(false);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelCopied, setTunnelCopied] = useState(false);
  const [devCommands, setDevCommands] = useState<Record<string, string>>({});
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [stickyError, setStickyError] = useState<string | null>(null);

  // Sync state when hosting prop changes
  useEffect(() => {
    setType(hosting.enabled ? hosting.type : (detectedHosting?.projectType ?? hosting.type));
    setHostname(hosting.hostname);
    setDocRoot(hosting.enabled ? (hosting.docRoot ?? "") : (detectedHosting?.docRoot ?? hosting.docRoot ?? ""));
    setStartCommand(hosting.enabled ? (hosting.startCommand ?? "") : (detectedHosting?.startCommand ?? hosting.startCommand ?? ""));
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

  const handleToggle = useCallback(async () => {
    try {
      if (hosting.enabled) {
        await onDisable(projectPath);
      } else {
        const portNum = internalPort ? Number(internalPort) : undefined;
        await onEnable({
          path: projectPath,
          type,
          hostname: hostname || undefined,
          docRoot: docRoot || undefined,
          startCommand: startCommand || undefined,
          mode,
          internalPort: portNum && !isNaN(portNum) ? portNum : undefined,
        });
      }
    } catch (err) {
      setStickyError(err instanceof Error ? err.message : String(err));
    }
  }, [hosting.enabled, projectPath, type, hostname, docRoot, startCommand, mode, internalPort, onEnable, onDisable]);

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
          Development
        </div>
        <button
          onClick={() => void handleToggle()}
          disabled={busy || !infraReady}
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
            hosting.enabled ? "bg-green" : "bg-surface1",
            (busy || !infraReady) && "opacity-50 cursor-not-allowed",
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
              hosting.enabled ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {!infraReady && !hosting.enabled && (
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
          <div className="w-full h-8 px-2 rounded-md border border-border bg-surface0/50 text-foreground text-[12px] flex items-center capitalize">
            {type.replace(/-/g, " ")}
          </div>
        </div>
        {runtimes.length > 0 && (
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
              {runtimes.map((r) => (
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

      {/* Environment Variables — always visible */}
      <div className="mb-3 pt-2 border-t border-border">
        <EnvManager projectPath={projectPath} />
      </div>

      {/* Stack dev commands — visible as soon as stacks are added */}
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
            compact
          />
        </div>
      )}

      {/* Status + actions — only when hosting is enabled */}
      {hosting.enabled && (
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

          {/* Project Logs + Container Terminal — always visible when hosting is enabled */}
          <div className="mt-3 pt-2 border-t border-border">
            <TerminalArea projectPath={projectPath} />
          </div>
        </div>
      )}
    </div>
  );
}
