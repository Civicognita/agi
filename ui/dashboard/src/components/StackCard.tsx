/**
 * StackCard — displays a single installed stack with its details.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { StackInfo, ProjectStackInstance, ProjectTypeTool, StackInstallAction } from "../types.js";

export interface StackCardProps {
  stack: StackInfo;
  instance: ProjectStackInstance;
  onRemove: (stackId: string) => void;
  onToolExecute?: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  onRunAction?: (stackId: string, actionId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  projectPath: string;
  removing?: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  runtime: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  database: "bg-green-500/20 text-green-300 border-green-500/30",
  tooling: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  framework: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  workflow: "bg-orange-500/20 text-orange-300 border-orange-500/30",
};

export function StackCard({ stack, instance, onRemove, onRunAction, projectPath, removing }: StackCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionOutput, setActionOutput] = useState<{ ok: boolean; text: string } | null>(null);

  const connectionUrl = instance.databaseName && instance.databaseUser && instance.databasePassword
    ? buildConnectionUrl(stack, instance)
    : null;

  function handleCopyUrl() {
    if (!connectionUrl) return;
    navigator.clipboard.writeText(connectionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleRemove() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 3000);
      return;
    }
    onRemove(stack.id);
  }

  return (
    <div className="rounded-lg border border-border bg-mantle p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-xs px-1.5 py-0.5 rounded border",
            CATEGORY_COLORS[stack.category] ?? "bg-border text-muted-foreground",
          )}>
            {stack.category}
          </span>
          <span className="font-medium text-sm text-foreground">{stack.label}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={cn("text-xs h-6", confirmRemove ? "text-red" : "text-muted-foreground")}
          onClick={handleRemove}
          disabled={removing}
        >
          {removing ? "Removing..." : confirmRemove ? "Confirm?" : "Remove"}
        </Button>
      </div>

      {/* Requirements pills */}
      {stack.requirements.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {stack.requirements.map((req) => (
            <span
              key={req.id}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded",
                req.type === "provided"
                  ? "bg-green/10 text-green"
                  : "bg-yellow/10 text-yellow",
              )}
            >
              {req.label}
            </span>
          ))}
        </div>
      )}

      {/* DB connection URL */}
      {connectionUrl && (
        <div className="flex items-center gap-1 bg-background rounded px-2 py-1">
          <code className="text-[11px] text-muted-foreground truncate flex-1">
            {connectionUrl}
          </code>
          <Button
            variant="ghost"
            size="sm"
            className="text-[10px] h-5 px-1.5"
            onClick={handleCopyUrl}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}

      {/* Expandable guides */}
      {stack.guides.length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue hover:underline"
        >
          {expanded ? "Hide guides" : `${stack.guides.length} guide${stack.guides.length > 1 ? "s" : ""}`}
        </button>
      )}

      {expanded && stack.guides.map((guide, i) => (
        <div key={i} className="text-xs text-muted-foreground bg-background rounded p-2">
          <div className="font-medium text-muted-foreground mb-1">{guide.title}</div>
          <div className="whitespace-pre-wrap">{guide.content}</div>
        </div>
      ))}

      {/* Dev commands */}
      {stack.devCommands && Object.keys(stack.devCommands).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(stack.devCommands).map(([key, cmd]) =>
            cmd ? (
              <span
                key={key}
                className="text-[10px] px-1.5 py-0.5 rounded bg-blue/10 text-blue"
                title={cmd}
              >
                {key}
              </span>
            ) : null,
          )}
        </div>
      )}

      {/* Install actions */}
      {stack.installActions && stack.installActions.length > 0 && onRunAction && (
        <>
          <button
            onClick={() => setActionsExpanded(!actionsExpanded)}
            className="text-xs text-peach hover:underline"
          >
            {actionsExpanded ? "Hide actions" : `${stack.installActions.length} install action${stack.installActions.length > 1 ? "s" : ""}`}
          </button>
          {actionsExpanded && (
            <div className="space-y-1">
              {stack.installActions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center justify-between bg-background rounded px-2 py-1"
                >
                  <div>
                    <span className="text-[11px] text-foreground">{action.label}</span>
                    {action.optional && (
                      <span className="text-[9px] text-muted-foreground ml-1">(optional)</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[10px] h-5 px-1.5 text-peach"
                    disabled={runningAction !== null}
                    onClick={async () => {
                      setRunningAction(action.id);
                      setActionOutput(null);
                      try {
                        const result = await onRunAction(stack.id, action.id);
                        setActionOutput({
                          ok: result.ok,
                          text: result.ok ? (result.output ?? "Done.") : (result.error ?? "Failed"),
                        });
                      } catch (err) {
                        setActionOutput({
                          ok: false,
                          text: err instanceof Error ? err.message : String(err),
                        });
                      } finally {
                        setRunningAction(null);
                      }
                    }}
                  >
                    {runningAction === action.id ? "..." : "Run"}
                  </Button>
                </div>
              ))}
              {actionOutput && (
                <pre
                  className={cn(
                    "p-1.5 rounded text-[10px] font-mono whitespace-pre-wrap max-h-24 overflow-auto border",
                    actionOutput.ok
                      ? "border-green/30 bg-green/5 text-green"
                      : "border-red/30 bg-red/5 text-red",
                  )}
                >
                  {actionOutput.text}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function buildConnectionUrl(stack: StackInfo, instance: ProjectStackInstance): string | null {
  if (!instance.databaseName || !instance.databaseUser || !instance.databasePassword) return null;

  // Simple placeholder-based URL (actual port comes from shared container)
  const engine = stack.category === "database" ? stack.id : "";
  if (engine.includes("postgres")) {
    return `postgresql://${instance.databaseUser}:${instance.databasePassword}@localhost/${instance.databaseName}`;
  }
  if (engine.includes("mariadb") || engine.includes("mysql")) {
    return `mysql://${instance.databaseUser}:${instance.databasePassword}@localhost/${instance.databaseName}`;
  }
  return null;
}
