/**
 * TerminalArea — two-tab area with Logs and Container Terminal.
 *
 * Replaces the inline ProjectLogViewer in HostingPanel when hosting is running.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ProjectLogViewer } from "./ProjectLogViewer.js";
import { ContainerTerminal } from "./ContainerTerminal.js";

export interface TerminalAreaProps {
  projectPath: string;
  /** Bump this key to switch to the logs tab and trigger a refresh. */
  refreshKey?: number;
}

export function TerminalArea({ projectPath, refreshKey }: TerminalAreaProps) {
  const [tab, setTab] = useState<"logs" | "terminal">("logs");

  // When refreshKey changes (e.g. after tool execution), switch to logs tab
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      setTab("logs");
    }
  }, [refreshKey]);

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
          <ProjectLogViewer projectPath={projectPath} refreshKey={refreshKey} />
        ) : (
          <ContainerTerminal projectPath={projectPath} />
        )}
      </div>
    </div>
  );
}
