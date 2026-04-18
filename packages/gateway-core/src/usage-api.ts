/**
 * Usage API — routing metadata and cost-mode breakdown endpoints.
 *
 * Exposes aggregated usage data by provider, model, and cost mode, plus
 * AgentRouter health and escalation statistics.
 */

import type { FastifyInstance } from "fastify";
import type { UsageStore } from "@agi/entity-model";

export interface UsageApiDeps {
  usageStore: UsageStore;
  getRouterStatus: () => { costMode: string; providers: Array<{ provider: string; healthy: boolean }> };
}

export function registerUsageRoutes(app: FastifyInstance, deps: UsageApiDeps): void {
  app.get("/api/usage/by-provider", async (req) => {
    const days = Number((req.query as Record<string, string>).days ?? "30");
    return deps.usageStore.getByProvider(days);
  });

  app.get("/api/usage/by-model", async (req) => {
    const days = Number((req.query as Record<string, string>).days ?? "30");
    return deps.usageStore.getByModel(days);
  });

  app.get("/api/usage/by-cost-mode", async (req) => {
    const days = Number((req.query as Record<string, string>).days ?? "30");
    return deps.usageStore.getByCostMode(days);
  });

  app.get("/api/usage/escalation-rate", async (req) => {
    const days = Number((req.query as Record<string, string>).days ?? "30");
    return deps.usageStore.getEscalationRate(days);
  });

  app.get("/api/router/status", async () => {
    return deps.getRouterStatus();
  });
}
