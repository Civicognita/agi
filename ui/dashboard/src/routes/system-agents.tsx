/**
 * System Agents page (tynn story #73).
 *
 * Dedicated control plane for the agents registered with this AGI
 * install. Surfaces the same data MachineAdmin's Agents section
 * already rendered but as a first-class page with more detail and
 * owner-only controls. Linked from the sidebar at /system/agents.
 */

import { useMemo } from "react";
import { useAgents } from "@/hooks.js";
import { PageScroll } from "@/components/PageScroll.js";
import { Card } from "@particle-academy/react-fancy";
import { Cpu, RefreshCw, Clock, HardDrive } from "lucide-react";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export default function SystemAgentsPage() {
  const { agents, loading, error, refresh, restart, restarting } = useAgents();

  const runningCount = useMemo(
    () => agents.filter((a) => a.status === "running").length,
    [agents],
  );

  return (
    <PageScroll>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Agents registered with this AGI install. Aionima is always the primary
              gateway agent; additional agents appear here when bound via{" "}
              <code className="text-xs font-mono">agent_bindings</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            className="text-xs px-3 py-1.5 border border-border rounded-md hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {error !== null && (
          <Card className="p-4 border-red-500/30 bg-red-500/5">
            <p className="text-sm text-red-400">Could not load agents: {error}</p>
          </Card>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            {loading ? "Loading..." : `${String(agents.length)} registered, ${String(runningCount)} running`}
          </span>
        </div>

        {loading ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">Loading agents...</p>
          </Card>
        ) : agents.length === 0 ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">
              No agents registered yet.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {agents.map((agent) => (
              <Card key={agent.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Cpu className="w-4 h-4 text-muted-foreground" />
                      <h3 className="font-medium text-foreground">{agent.name}</h3>
                      <span
                        className={
                          "text-[11px] px-2 py-0.5 rounded-full " +
                          (agent.status === "running"
                            ? "bg-green-500/15 text-green-400"
                            : "bg-amber-500/15 text-amber-400")
                        }
                      >
                        {agent.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {agent.type}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-2">
                      {agent.uptime !== undefined && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {formatUptime(agent.uptime)}
                        </span>
                      )}
                      {agent.memoryMB !== undefined && (
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-3 h-3" /> {agent.memoryMB}&nbsp;MB
                        </span>
                      )}
                      {agent.pid !== undefined && (
                        <span className="font-mono">PID {agent.pid}</span>
                      )}
                    </div>
                    {agent.channels && agent.channels.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-2">
                        Channels: {agent.channels.join(", ")}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { void restart(agent.id); }}
                    disabled={restarting || agent.status !== "running"}
                    className="text-xs px-3 py-1.5 border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={agent.status !== "running" ? "Agent is not running" : "Restart agent"}
                  >
                    {restarting ? "Restarting..." : "Restart"}
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}

        <Card className="p-4 bg-muted/30">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong>Orchestration:</strong> to add a new agent, bind it through
            the Identity service via the{" "}
            <code className="text-xs font-mono">agent_bindings</code> table
            (owner entity ↔ agent entity). Once bound, the agent appears here
            and can be managed like Aionima.
          </p>
        </Card>
      </div>
    </PageScroll>
  );
}
