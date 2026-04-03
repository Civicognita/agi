import { type FC } from "react";
import { cn } from "@/lib/utils";

interface ToolActivity {
  toolName: string;
  loopIteration: number;
  status: "running" | "complete" | "error";
  summary?: string;
  timestamp: string;
}

interface ActivityIndicatorProps {
  toolActivity: ToolActivity[];
}

const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  manage_project: "Updating project settings",
  shell_exec: "Running commands",
  dir_list: "Browsing files",
  file_read: "Reading files",
  file_write: "Writing files",
  create_plan: "Creating plan",
  update_plan: "Updating plan",
  taskmaster_dispatch: "Dispatching work",
  search_prime: "Searching knowledge base",
};

const ActivityIndicator: FC<ActivityIndicatorProps> = ({ toolActivity }) => {
  const runningTool = [...toolActivity].reverse().find((t) => t.status === "running");
  const label = runningTool
    ? (TOOL_FRIENDLY_NAMES[runningTool.toolName] ?? "Working") + "..."
    : "Thinking...";

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground text-[13px]">
      <span className={cn(
        "inline-block w-1.5 h-1.5 rounded-full animate-pulse",
        runningTool ? "bg-blue" : "bg-muted-foreground",
      )} />
      <span>{label}</span>
    </div>
  );
};

export default ActivityIndicator;
