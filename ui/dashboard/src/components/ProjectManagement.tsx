/**
 * ProjectManagement — management panel for non-hostable project types
 * (writing, art, production). Shows status, description, and type-specific tools.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ProjectTypeInfo, ProjectTypeTool } from "../types.js";

export interface ProjectManagementProps {
  projectPath: string;
  projectType: ProjectTypeInfo;
  description?: string;
  onToolExecute?: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
}

export function ProjectManagement({
  projectPath,
  projectType,
  description,
  onToolExecute,
}: ProjectManagementProps) {
  const [toolOutput, setToolOutput] = useState<string | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [runningTool, setRunningTool] = useState<string | null>(null);

  const handleRunTool = async (tool: ProjectTypeTool) => {
    if (!onToolExecute || tool.action !== "shell") return;
    setRunningTool(tool.id);
    setToolOutput(null);
    setToolError(null);
    try {
      const result = await onToolExecute(projectPath, tool.id);
      if (result.ok) {
        setToolOutput(result.output ?? "Done.");
      } else {
        setToolError(result.error ?? "Unknown error");
      }
    } catch (err) {
      setToolError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningTool(null);
    }
  };

  const shellTools = projectType.tools.filter((t) => t.action === "shell");
  const uiTools = projectType.tools.filter((t) => t.action === "ui");

  return (
    <div className="space-y-4">
      {/* Project type badge */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-mauve/15 text-mauve font-semibold">
          {projectType.label}
        </span>
        <span className="text-[10px] text-muted-foreground capitalize">
          {projectType.category}
        </span>
      </div>

      {/* Description */}
      {description && (
        <div className="p-3 rounded-lg border border-border bg-mantle">
          <div className="text-[10px] font-semibold text-muted-foreground mb-1">Description</div>
          <div className="text-[12px] text-card-foreground">{description}</div>
        </div>
      )}

      {/* Tools */}
      {(shellTools.length > 0 || uiTools.length > 0) && (
        <div className="p-3 rounded-lg border border-border bg-mantle">
          <div className="text-[10px] font-semibold text-muted-foreground mb-2">Tools</div>
          <div className="flex flex-wrap gap-1.5">
            {shellTools.map((tool) => (
              <Button
                key={tool.id}
                size="sm"
                variant="outline"
                className="text-[11px] h-7"
                disabled={runningTool !== null}
                onClick={() => void handleRunTool(tool)}
                title={tool.description}
              >
                {runningTool === tool.id ? "Running..." : tool.label}
              </Button>
            ))}
            {uiTools.map((tool) => (
              <Button
                key={tool.id}
                size="sm"
                variant="secondary"
                className="text-[11px] h-7"
                disabled
                title={`${tool.description} (coming soon)`}
              >
                {tool.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Tool output */}
      {(toolOutput || toolError) && (
        <div className={cn(
          "p-3 rounded-lg border text-[11px] font-mono whitespace-pre-wrap max-h-48 overflow-auto",
          toolError
            ? "border-red/30 bg-red/5 text-red"
            : "border-border bg-mantle text-card-foreground",
        )}>
          {toolError ?? toolOutput}
        </div>
      )}
    </div>
  );
}
