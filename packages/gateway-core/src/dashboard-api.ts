/**
 * Dashboard API Handler — Task #154
 *
 * HTTP route handlers for the impact dashboard.
 * Uses native Node.js http — no Express dependency.
 *
 * Routes:
 *   GET /api/dashboard/overview
 *   GET /api/dashboard/timeline
 *   GET /api/dashboard/breakdown
 *   GET /api/dashboard/leaderboard
 *   GET /api/dashboard/entity/:id
 *   GET /api/dashboard/coa
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { DashboardQueries } from "./dashboard-queries.js";
import type {
  BreakdownDimension,
  TimeBucket,
} from "./dashboard-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardApiDeps {
  queries: DashboardQueries;
}

interface RouteMatch {
  handler: (req: IncomingMessage, res: ServerResponse, params: URLSearchParams, pathParams: Record<string, string>) => void;
  pathParams: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

function intParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const VALID_BUCKETS = new Set<TimeBucket>(["hour", "day", "week", "month"]);
const VALID_DIMENSIONS = new Set<BreakdownDimension>(["domain", "channel", "workType"]);

// ---------------------------------------------------------------------------
// DashboardApi
// ---------------------------------------------------------------------------

export class DashboardApi {
  readonly queries: DashboardQueries;

  constructor(deps: DashboardApiDeps) {
    this.queries = deps.queries;
  }

  /**
   * Handle an HTTP request.
   * Returns true if the request was handled, false if the path didn't match.
   */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const params = url.searchParams;

    if (req.method !== "GET") {
      if (pathname.startsWith("/api/dashboard")) {
        error(res, "Method not allowed", 405);
        return true;
      }
      return false;
    }

    const match = this.matchRoute(pathname);
    if (match === null) return false;

    try {
      match.handler(req, res, params, match.pathParams);
    } catch (err) {
      if (err instanceof Error) console.error("[dashboard-api]", err.message);
      error(res, "Internal server error", 500);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Route matching
  // ---------------------------------------------------------------------------

  private matchRoute(pathname: string): RouteMatch | null {
    if (pathname === "/api/dashboard/overview") {
      return { handler: this.handleOverview, pathParams: {} };
    }
    if (pathname === "/api/dashboard/timeline") {
      return { handler: this.handleTimeline, pathParams: {} };
    }
    if (pathname === "/api/dashboard/breakdown") {
      return { handler: this.handleBreakdown, pathParams: {} };
    }
    if (pathname === "/api/dashboard/leaderboard") {
      return { handler: this.handleLeaderboard, pathParams: {} };
    }
    if (pathname === "/api/dashboard/coa") {
      return { handler: this.handleCOA, pathParams: {} };
    }

    // /api/dashboard/entity/:id
    const entityMatch = /^\/api\/dashboard\/entity\/([a-zA-Z0-9]+)$/.exec(pathname);
    if (entityMatch?.[1] !== undefined) {
      return { handler: this.handleEntityProfile, pathParams: { id: entityMatch[1] } };
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  private handleOverview = (_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): void => {
    const windowDays = intParam(params, "windowDays", 90);
    const recentLimit = intParam(params, "recentLimit", 20);
    void this.queries.getOverview(windowDays, recentLimit)
      .then((overview) => { json(res, overview); })
      .catch(() => error(res, "Failed to fetch overview"));
  };

  private handleTimeline = (_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): void => {
    const bucket = params.get("bucket") ?? "day";
    if (!VALID_BUCKETS.has(bucket as TimeBucket)) {
      error(res, `Invalid bucket: ${bucket}. Valid: hour, day, week, month`);
      return;
    }

    const entityId = params.get("entityId") ?? undefined;
    const since = params.get("since") ?? undefined;
    const until = params.get("until") ?? undefined;

    void this.queries.getTimeline(
      bucket as TimeBucket,
      entityId,
      since,
      until,
    ).then((buckets) => {
      json(res, {
        buckets,
        bucket,
        since: since ?? "all-time",
        until: until ?? "now",
      });
    }).catch(() => error(res, "Failed to fetch timeline"));
  };

  private handleBreakdown = (_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): void => {
    const dimension = params.get("by") ?? "domain";
    if (!VALID_DIMENSIONS.has(dimension as BreakdownDimension)) {
      error(res, `Invalid dimension: ${dimension}. Valid: domain, channel, workType`);
      return;
    }

    const entityId = params.get("entityId") ?? undefined;
    const since = params.get("since") ?? undefined;
    const until = params.get("until") ?? undefined;

    void this.queries.getBreakdown(
      dimension as BreakdownDimension,
      entityId,
      since,
      until,
    ).then(({ slices, total }) => {
      json(res, { dimension, slices, total });
    }).catch(() => error(res, "Failed to fetch breakdown"));
  };

  private handleLeaderboard = (_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): void => {
    const windowDays = intParam(params, "windowDays", 90);
    const limit = intParam(params, "limit", 25);
    const offset = intParam(params, "offset", 0);

    void this.queries.getLeaderboard(windowDays, limit, offset).then(({ entries, total }) => {
      json(res, {
        entries,
        windowDays,
        total,
        computedAt: new Date().toISOString(),
      });
    }).catch(() => error(res, "Failed to fetch leaderboard"));
  };

  private handleEntityProfile = (
    _req: IncomingMessage,
    res: ServerResponse,
    params: URLSearchParams,
    pathParams: Record<string, string>,
  ): void => {
    const entityId = pathParams["id"];
    if (entityId === undefined) {
      error(res, "Entity ID required", 400);
      return;
    }

    const windowDays = intParam(params, "windowDays", 90);
    void this.queries.getEntityProfile(entityId, windowDays)
      .then((profile) => {
        if (profile === null) {
          error(res, "Entity not found", 404);
          return;
        }
        json(res, profile);
      })
      .catch(() => error(res, "Failed to fetch entity profile"));
  };

  private handleCOA = (_req: IncomingMessage, res: ServerResponse, params: URLSearchParams): void => {
    void this.queries.getCOAEntries({
      entityId: params.get("entityId") ?? undefined,
      fingerprint: params.get("fingerprint") ?? undefined,
      workType: params.get("workType") ?? undefined,
      since: params.get("since") ?? undefined,
      until: params.get("until") ?? undefined,
      limit: intParam(params, "limit", 50),
      offset: intParam(params, "offset", 0),
    })
      .then((result) => { json(res, result); })
      .catch(() => error(res, "Failed to fetch COA entries"));
  };
}
