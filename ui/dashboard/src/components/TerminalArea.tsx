/**
 * TerminalArea — two-tab area with Logs and Container Terminal.
 *
 * Replaces the inline ProjectLogViewer in HostingPanel when hosting is running.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ProjectLogViewer } from "./ProjectLogViewer.js";
import { ContainerTerminal } from "./ContainerTerminal.js";

export interface TerminalAreaProps {
  projectPath: string;
}

export function TerminalArea({ projectPath }: TerminalAreaProps) {
  const [tab, setTab] = useState<"logs" | "terminal">("logs");

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border bg-mantle">
        <button
          onClick={() => setTab("logs")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "logs"
              ? "text-foreground border-b-2 border-blue"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Logs
        </button>
        <button
          onClick={() => setTab("terminal")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "terminal"
              ? "text-foreground border-b-2 border-blue"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Terminal
        </button>
      </div>

      {/* Content */}
      <div className="max-h-64 overflow-hidden">
        {tab === "logs" ? (
          <ProjectLogViewer projectPath={projectPath} />
        ) : (
          <ContainerTerminal projectPath={projectPath} />
        )}
      </div>
    </div>
  );
}
