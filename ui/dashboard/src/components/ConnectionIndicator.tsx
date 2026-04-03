/**
 * ConnectionIndicator — compact header widget showing AGI, PRIME, workspace, and ID status.
 * Polls GET /api/system/connections every 30s and renders colored dots with tooltips.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchConnectionStatus } from "../api.js";
import type { ConnectionStatus } from "../types.js";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours < 24) return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

type NodeStatus = "connected" | "missing" | "empty" | "error";

interface StatusNode {
  label: string;
  status: NodeStatus;
  tooltip: string;
}

function statusColor(status: NodeStatus): string {
  switch (status) {
    case "connected": return "bg-green";
    case "missing":
    case "empty": return "bg-yellow";
    case "error": return "bg-red";
  }
}

function buildNodes(data: ConnectionStatus): StatusNode[] {
  const nodes: StatusNode[] = [
    {
      label: "AGI",
      status: "connected",
      tooltip: `${data.agi.branch}@${data.agi.commit} · up ${formatUptime(data.agi.uptime)}`,
    },
    {
      label: "PRIME",
      status: data.prime.status,
      tooltip: data.prime.status === "connected"
        ? `${data.prime.entries} entries · ${data.prime.branch ?? "n/a"}`
        : data.prime.status === "missing"
          ? "Corpus not found"
          : "Error reading corpus",
    },
    {
      label: "Workspace",
      status: data.workspace.status,
      tooltip: data.workspace.status === "connected"
        ? `${data.workspace.accessible}/${data.workspace.configured} projects`
        : data.workspace.status === "empty"
          ? "No projects configured"
          : "Project dirs inaccessible",
    },
  ];

  if (data.idService) {
    nodes.push({
      label: "ID",
      status: data.idService.status === "central" ? "connected"
        : data.idService.status === "degraded" ? "missing"
        : data.idService.status,
      tooltip: data.idService.status === "connected"
        ? `Local · ${data.idService.url}`
        : data.idService.status === "central"
          ? "Central · id.aionima.ai"
          : data.idService.status === "degraded"
            ? `Local · degraded (views broken)`
            : `${data.idService.mode} · unreachable`,
    });
  }

  return nodes;
}

export function ConnectionIndicator() {
  const [data, setData] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    const load = () => { fetchConnectionStatus().then(setData).catch(() => {}); };
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  const nodes = buildNodes(data);

  return (
    <div className="flex items-center gap-3 px-2 py-1 rounded-lg bg-secondary/50" data-testid="connection-indicator">
      {nodes.map((node) => (
        <div key={node.label} className="flex items-center gap-1.5 group relative" title={`${node.label}: ${node.tooltip}`}>
          <span className={cn(
            "inline-block w-1.5 h-1.5 rounded-full shrink-0",
            statusColor(node.status),
            node.status === "connected" && "shadow-[0_0_4px_rgba(var(--green-rgb,64,192,87),0.5)]",
          )} />
          <span className="text-[10px] font-medium text-muted-foreground leading-none">
            {node.label}
          </span>
        </div>
      ))}
    </div>
  );
}
