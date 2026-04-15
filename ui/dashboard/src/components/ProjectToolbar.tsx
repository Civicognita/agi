/**
 * ProjectToolbar — reusable toolbar rendering tools from the project type registry.
 * Used in both HostingPanel (for hostable types) and ProjectManagement (for all types).
 *
 * Tool output is streamed to the project log viewer (via podman logs), not shown inline.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button";
import type { ProjectTypeTool } from "../types.js";

export interface ProjectToolbarProps {
  tools: ProjectTypeTool[];
  projectPath: string;
  onExecute: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  compact?: boolean;
  /** Called after a tool finishes so the parent can refresh logs / switch tabs. */
  onToolComplete?: (result: { ok: boolean; toolId: string }) => void;
}

export function ProjectToolbar({
  tools,
  projectPath,
  onExecute,
  compact = false,
  onToolComplete,
}: ProjectToolbarProps) {
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const { toast } = useToast();

  const handleRun = async (tool: ProjectTypeTool) => {
    if (tool.action !== "shell" || !tool.command) return;
    setRunningTool(tool.id);
    toast({ title: `Running: ${tool.label}`, description: "Output will appear in the project logs.", variant: "info" });
    try {
      const result = await onExecute(projectPath, tool.id);
      onToolComplete?.({ ok: result.ok, toolId: tool.id });
      if (result.ok) {
        toast({ title: `${tool.label} completed`, variant: "success" });
      } else {
        toast({ title: `${tool.label} failed`, description: result.error ?? "Check project logs for details.", variant: "error" });
      }
    } catch (err) {
      onToolComplete?.({ ok: false, toolId: tool.id });
      toast({ title: `${tool.label} failed`, description: err instanceof Error ? err.message : "Unexpected error", variant: "error" });
    } finally {
      setRunningTool(null);
    }
  };

  const shellTools = tools.filter((t) => t.action === "shell");
  const uiTools = tools.filter((t) => t.action === "ui");

  if (shellTools.length === 0 && uiTools.length === 0) return null;

  return (
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
          data-testid="project-action-button"
          data-command={tool.command ?? tool.description}
          data-tool-id={tool.id}
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
  );
}
