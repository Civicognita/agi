/**
 * ProjectToolbar — reusable toolbar rendering tools from the project type registry.
 * Used in both HostingPanel (for hostable types) and ProjectManagement (for all types).
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ProjectTypeTool } from "../types.js";

export interface ProjectToolbarProps {
  tools: ProjectTypeTool[];
  projectPath: string;
  onExecute: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  compact?: boolean;
}

export function ProjectToolbar({
  tools,
  projectPath,
  onExecute,
  compact = false,
}: ProjectToolbarProps) {
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);

  const handleRun = async (tool: ProjectTypeTool) => {
    if (tool.action !== "shell" || !tool.command) return;
    setRunningTool(tool.id);
    setOutput(null);
    setError(null);
    setShowOutput(true);
    try {
      const result = await onExecute(projectPath, tool.id);
      if (result.ok) {
        setOutput(result.output ?? "Done.");
      } else {
        setError(result.error ?? "Unknown error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningTool(null);
    }
  };

  const shellTools = tools.filter((t) => t.action === "shell");
  const uiTools = tools.filter((t) => t.action === "ui");

  if (shellTools.length === 0 && uiTools.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {shellTools.map((tool) => (
          <Button
            key={tool.id}
            size="sm"
            variant="outline"
            className={cn("text-[11px]", compact ? "h-6 px-2" : "h-7")}
            disabled={runningTool !== null}
            onClick={() => void handleRun(tool)}
            title={tool.description}
          >
            {runningTool === tool.id ? "..." : tool.label}
          </Button>
        ))}
        {uiTools.map((tool) => (
          <Button
            key={tool.id}
            size="sm"
            variant="secondary"
            className={cn("text-[11px]", compact ? "h-6 px-2" : "h-7")}
            disabled
            title={`${tool.description} (coming soon)`}
          >
            {tool.label}
          </Button>
        ))}
      </div>

      {/* Output overlay */}
      {showOutput && (output || error) && (
        <div className="relative">
          <button
            onClick={() => setShowOutput(false)}
            className="absolute top-1 right-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            close
          </button>
          <pre className={cn(
            "p-2 rounded-lg border text-[10px] font-mono whitespace-pre-wrap max-h-40 overflow-auto",
            error
              ? "border-red/30 bg-red/5 text-red"
              : "border-border bg-mantle text-card-foreground",
          )}>
            {error ?? output}
          </pre>
        </div>
      )}
    </div>
  );
}
