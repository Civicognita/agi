/**
 * Plan API — HTTP route handlers for plan CRUD operations.
 *
 * Routes:
 *   GET    /api/plans?projectPath=...       List plans for a project
 *   GET    /api/plans/:planId?projectPath=  Get a single plan
 *   POST   /api/plans                       Create a plan
 *   PUT    /api/plans/:planId               Update plan status/steps
 *   DELETE /api/plans/:planId               Delete a plan
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { PlanStore, isAcceptedStatus } from "./plan-store.js";
import type { CreatePlanInput, UpdatePlanInput } from "./plan-types.js";
import { planViewFromStatus } from "./plan-types.js";

const planStore = new PlanStore();

function jsonResponse(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Handle plan API requests. Returns true if the request was handled.
 */
export function handlePlanRequest(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): boolean {
  // GET /api/plans — list plans. `?exclude=done` hides plans whose
  // view status is "done" (complete | failed) so the dashboard's Plans
  // tab can show only actionable work by default.
  if (req.method === "GET" && pathname === "/api/plans") {
    const projectPath = url.searchParams.get("projectPath");
    if (!projectPath) {
      jsonResponse(res, { error: "projectPath query parameter is required" }, 400);
      return true;
    }
    const exclude = url.searchParams.get("exclude");
    let plans = planStore.list(projectPath);
    if (exclude === "done") {
      plans = plans.filter((p) => planViewFromStatus(p.status) !== "done");
    }
    jsonResponse(res, plans);
    return true;
  }

  // GET /api/plans/:planId — get a single plan
  const getMatch = pathname.match(/^\/api\/plans\/(plan_[A-Z0-9]+)$/);
  if (req.method === "GET" && getMatch) {
    const planId = getMatch[1]!;
    const projectPath = url.searchParams.get("projectPath");
    if (!projectPath) {
      jsonResponse(res, { error: "projectPath query parameter is required" }, 400);
      return true;
    }
    const plan = planStore.get(projectPath, planId);
    if (!plan) {
      jsonResponse(res, { error: "Plan not found" }, 404);
      return true;
    }
    jsonResponse(res, plan);
    return true;
  }

  // POST /api/plans — create a plan
  if (req.method === "POST" && pathname === "/api/plans") {
    readBody(req).then((bodyStr) => {
      try {
        const input = JSON.parse(bodyStr) as CreatePlanInput;
        if (!input.title || !input.projectPath || !input.steps || !input.body) {
          jsonResponse(res, { error: "title, projectPath, steps, and body are required" }, 400);
          return;
        }
        const plan = planStore.create(input);
        jsonResponse(res, plan, 201);
      } catch (err) {
        jsonResponse(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }).catch((err: unknown) => {
      jsonResponse(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    });
    return true;
  }

  // PUT /api/plans/:planId — update a plan.
  //
  // Accept-lock: once a plan is approved (or later), body, title, and
  // step-list edits are rejected. Step-status advances and plan-status
  // transitions still flow through. Dashboard callers should keep plans
  // open in Editor mode while status is "draft"/"reviewing" and switch
  // to a read-only viewer afterwards.
  const putMatch = pathname.match(/^\/api\/plans\/(plan_[A-Z0-9]+)$/);
  if (req.method === "PUT" && putMatch) {
    const planId = putMatch[1]!;
    readBody(req).then((bodyStr) => {
      try {
        const body = JSON.parse(bodyStr) as UpdatePlanInput & { projectPath?: string };
        const projectPath = body.projectPath;
        if (!projectPath) {
          jsonResponse(res, { error: "projectPath is required in body" }, 400);
          return;
        }

        const existing = planStore.get(projectPath, planId);
        if (!existing) {
          jsonResponse(res, { error: "Plan not found" }, 404);
          return;
        }

        if (isAcceptedStatus(existing.status)) {
          if (body.body !== undefined || body.title !== undefined || body.steps !== undefined) {
            jsonResponse(res, {
              error: `Plan is ${existing.status} — body, title, and step list are locked. Only step-status advances are permitted after acceptance.`,
            }, 409);
            return;
          }
          if (body.status === "draft" || body.status === "reviewing") {
            jsonResponse(res, {
              error: `Cannot regress plan from ${existing.status} to ${body.status}. Delete the plan and create a new one if you need to redraft.`,
            }, 409);
            return;
          }
        }

        const plan = planStore.update(projectPath, planId, body);
        if (!plan) {
          jsonResponse(res, { error: "Plan not found" }, 404);
          return;
        }
        jsonResponse(res, plan);
      } catch (err) {
        jsonResponse(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }).catch((err: unknown) => {
      jsonResponse(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    });
    return true;
  }

  // DELETE /api/plans/:planId — delete a plan
  const deleteMatch = pathname.match(/^\/api\/plans\/(plan_[A-Z0-9]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    const planId = deleteMatch[1]!;
    const projectPath = url.searchParams.get("projectPath");
    if (!projectPath) {
      jsonResponse(res, { error: "projectPath query parameter is required" }, 400);
      return true;
    }
    const deleted = planStore.delete(projectPath, planId);
    if (!deleted) {
      jsonResponse(res, { error: "Plan not found" }, 404);
      return true;
    }
    jsonResponse(res, { ok: true });
    return true;
  }

  return false;
}
