/**
 * SystemServiceManager — manages plugin-registered system services.
 * Provides status checks, start/stop/restart via systemd or custom commands.
 */

import { execFile } from "node:child_process";
import type { PluginRegistry } from "@agi/plugins";
import type { Logger } from "./logger.js";

export interface ServiceStatus {
  id: string;
  pluginId: string;
  name: string;
  description?: string;
  status: "running" | "stopped" | "unknown";
  unitName?: string;
  agentAware?: boolean;
  agentDescription?: string;
}

export class SystemServiceManager {
  constructor(private readonly deps: { pluginRegistry: PluginRegistry; logger?: Logger }) {
  }

  /** Get status of all registered system services. */
  async getStatuses(): Promise<ServiceStatus[]> {
    const registered = this.deps.pluginRegistry.getSystemServices();
    const results: ServiceStatus[] = [];

    for (const { pluginId, service } of registered) {
      let status: "running" | "stopped" | "unknown" = "unknown";

      try {
        if (service.statusCommand) {
          status = await this.execCheck(service.statusCommand) ? "running" : "stopped";
        } else if (service.unitName) {
          status = await this.systemdCheck(service.unitName) ? "running" : "stopped";
        }
      } catch {
        status = "unknown";
      }

      results.push({
        id: service.id,
        pluginId,
        name: service.name,
        description: service.description,
        status,
        unitName: service.unitName,
        agentAware: service.agentAware,
        agentDescription: service.agentDescription,
      });
    }

    return results;
  }

  /** Get agent-awareness descriptions for system prompt injection. */
  getAgentDescriptions(): string[] {
    return this.deps.pluginRegistry.getSystemServices()
      .filter((s) => s.service.agentAware && s.service.agentDescription)
      .map((s) => s.service.agentDescription!);
  }

  private execCheck(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile("bash", ["-c", command], { timeout: 10_000 }, (err) => {
        resolve(!err);
      });
    });
  }

  private systemdCheck(unitName: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile("systemctl", ["is-active", "--quiet", unitName], { timeout: 10_000 }, (err) => {
        resolve(!err);
      });
    });
  }
}
