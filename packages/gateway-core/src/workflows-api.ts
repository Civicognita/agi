/**
 * Workflows API — FlowGraph CRUD surface (s176 2026-05-15).
 *
 *   GET    /api/workflows            list all saved workflows (metadata only)
 *   GET    /api/workflows/:id        load a single workflow (full FlowGraph)
 *   POST   /api/workflows            create a new workflow
 *   PUT    /api/workflows/:id        update a workflow (name and/or graph)
 *   DELETE /api/workflows/:id        delete a workflow
 *
 * Storage: ~/.agi/workflows/{id}.json — each file is a WorkflowRecord.
 * The FlowGraph shape is owned by @particle-academy/fancy-flow; the gateway
 * treats it as opaque JSON to stay decoupled from frontend versioning.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Opaque FlowGraph shape from @particle-academy/fancy-flow. */
export interface FlowGraph {
  nodes: unknown[];
  edges: unknown[];
}

export interface WorkflowRecord {
  id: string;
  name: string;
  graph: FlowGraph;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowSummary = Omit<WorkflowRecord, "graph">;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function workflowsDir(): string {
  return join(homedir(), ".agi", "workflows");
}

function ensureDir(): string {
  const dir = workflowsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function filePath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

function isValidId(id: string): boolean {
  return /^[a-z0-9_-]{1,64}$/.test(id);
}

function readRecord(dir: string, id: string): WorkflowRecord | null {
  const fp = filePath(dir, id);
  if (!existsSync(fp)) return null;
  try {
    return JSON.parse(readFileSync(fp, "utf8")) as WorkflowRecord;
  } catch {
    return null;
  }
}

function writeRecord(dir: string, record: WorkflowRecord): void {
  writeFileSync(filePath(dir, record.id), JSON.stringify(record, null, 2), "utf8");
}

function listRecords(dir: string): WorkflowSummary[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const id = f.slice(0, -5);
      const record = readRecord(dir, id);
      if (!record) return [];
      const { graph: _g, ...summary } = record;
      return [summary];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerWorkflowsRoutes(app: FastifyInstance): void {
  /** GET /api/workflows — list workflow summaries */
  app.get("/api/workflows", async (_req, reply) => {
    const dir = ensureDir();
    return reply.send({ workflows: listRecords(dir) });
  });

  /** GET /api/workflows/:id — load full workflow */
  app.get<{ Params: { id: string } }>("/api/workflows/:id", async (request, reply) => {
    const { id } = request.params;
    if (!isValidId(id)) return reply.code(400).send({ error: "invalid workflow id" });
    const dir = ensureDir();
    const record = readRecord(dir, id);
    if (!record) return reply.code(404).send({ error: "workflow not found" });
    return reply.send(record);
  });

  /** POST /api/workflows — create a new workflow */
  app.post<{ Body: { name?: unknown; graph?: unknown } }>("/api/workflows", {
    schema: { body: { type: "object" } },
  }, async (request, reply) => {
    const { name, graph } = request.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      return reply.code(400).send({ error: "name is required" });
    }
    const dir = ensureDir();
    const id = `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const record: WorkflowRecord = {
      id,
      name: name.trim(),
      graph: (graph as FlowGraph | undefined) ?? { nodes: [], edges: [] },
      createdAt: now,
      updatedAt: now,
    };
    writeRecord(dir, record);
    return reply.code(201).send(record);
  });

  /** PUT /api/workflows/:id — update name and/or graph */
  app.put<{ Params: { id: string }; Body: { name?: unknown; graph?: unknown } }>("/api/workflows/:id", {
    schema: { body: { type: "object" } },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!isValidId(id)) return reply.code(400).send({ error: "invalid workflow id" });
    const dir = ensureDir();
    const existing = readRecord(dir, id);
    if (!existing) return reply.code(404).send({ error: "workflow not found" });
    const { name, graph } = request.body ?? {};
    const updated: WorkflowRecord = {
      ...existing,
      name: typeof name === "string" && name.trim() ? name.trim() : existing.name,
      graph: graph !== undefined ? (graph as FlowGraph) : existing.graph,
      updatedAt: new Date().toISOString(),
    };
    writeRecord(dir, updated);
    return reply.send(updated);
  });

  /** DELETE /api/workflows/:id */
  app.delete<{ Params: { id: string } }>("/api/workflows/:id", async (request, reply) => {
    const { id } = request.params;
    if (!isValidId(id)) return reply.code(400).send({ error: "invalid workflow id" });
    const dir = ensureDir();
    const fp = filePath(dir, id);
    if (!existsSync(fp)) return reply.code(404).send({ error: "workflow not found" });
    unlinkSync(fp);
    return reply.code(204).send();
  });
}
