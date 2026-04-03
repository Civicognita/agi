/**
 * Reports API — REST endpoints for browsing BOTS worker reports.
 *
 * Endpoints:
 *   GET /api/dashboard/reports            — paginated list with filters
 *   GET /api/dashboard/reports/:coaReqId  — full report detail
 */

import type { FastifyInstance } from "fastify";
import type { ReportsStore } from "./reports-store.js";

export function registerReportsApi(
  app: FastifyInstance,
  store: ReportsStore,
): void {
  // List reports
  app.get("/api/dashboard/reports", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const { reports, total } = store.list({
      project: query.project,
      since: query.since,
      until: query.until,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    return { reports, total };
  });

  // Get report detail
  app.get<{ Params: { coaReqId: string } }>("/api/dashboard/reports/:coaReqId", async (request, reply) => {
    const report = store.get(request.params.coaReqId);
    if (!report) {
      return reply.status(404).send({ error: "Report not found" });
    }
    return report;
  });
}
