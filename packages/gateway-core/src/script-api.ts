/**
 * Script API — MApp script REST surface (s182 Phase E + s102 Phase D).
 *
 *   GET    /api/scripts?mappId=...        list scripts for a MApp
 *   GET    /api/scripts/:id               single fetch
 *   POST   /api/scripts                   create
 *   PATCH  /api/scripts/:id               update (name / description / source)
 *   POST   /api/scripts/:id/compile       encode source as wasmB64 (Phase D)
 *   POST   /api/scripts/:id/enable        set enabled=true
 *   POST   /api/scripts/:id/disable       set enabled=false
 *   DELETE /api/scripts/:id               remove
 *
 * Deny-by-default lifecycle: scripts are created with enabled=false and
 * wasmB64=null. The enable toggle is accepted but runtime enforcement of the
 * Phase D "must be compiled" gate lives in the run_script agent tool — the
 * HTTP surface doesn't re-check wasmB64 so the UI can show the flag freely.
 */

import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ScriptRegistry, CreateScriptInput, UpdateScriptInput } from "./script-registry.js";

function sha256Hex(data: string | Uint8Array): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

export interface ScriptApiDeps {
  scriptRegistry: ScriptRegistry;
}

export function registerScriptRoutes(app: FastifyInstance, deps: ScriptApiDeps): void {
  const { scriptRegistry } = deps;

  /** GET /api/scripts?mappId=... */
  app.get("/api/scripts", async (request, reply) => {
    const query = request.query as { mappId?: string };
    if (typeof query.mappId !== "string" || query.mappId.length === 0) {
      return reply.code(400).send({ error: "mappId query parameter is required" });
    }
    const scripts = await scriptRegistry.list(query.mappId);
    return { scripts };
  });

  /** GET /api/scripts/:id */
  app.get<{ Params: { id: string } }>("/api/scripts/:id", async (request, reply) => {
    const script = await scriptRegistry.get(request.params.id);
    if (script === null) {
      return reply.code(404).send({ error: `script ${request.params.id} not found` });
    }
    return script;
  });

  /**
   * POST /api/scripts
   * Body: { mappId, name, description?, language?, source? }
   */
  app.post("/api/scripts", async (request, reply) => {
    const body = request.body as Partial<CreateScriptInput>;
    if (typeof body.mappId !== "string" || body.mappId.length === 0) {
      return reply.code(400).send({ error: "mappId is required" });
    }
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return reply.code(400).send({ error: "name is required" });
    }
    const created = await scriptRegistry.create({
      mappId: body.mappId,
      name: body.name.trim(),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      language: "starlark",
      ...(typeof body.source === "string" ? { source: body.source } : {}),
      isPacker: body.isPacker === true,
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : 1000,
      maxMemoryPages: typeof body.maxMemoryPages === "number" ? body.maxMemoryPages : 256,
    });
    return reply.code(201).send(created);
  });

  /**
   * PATCH /api/scripts/:id
   * Body: { name?, description?, source?, isPacker?, timeoutMs?, maxMemoryPages? }
   * Updating source clears wasmB64/wasmHash (stale-compile invalidation).
   */
  app.patch<{ Params: { id: string } }>("/api/scripts/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = await scriptRegistry.get(id);
    if (existing === null) {
      return reply.code(404).send({ error: `script ${id} not found` });
    }
    const body = request.body as UpdateScriptInput;
    const patch: UpdateScriptInput = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.description === "string" || body.description === null) patch.description = body.description;
    if (typeof body.source === "string" || body.source === null) patch.source = body.source;
    if (typeof body.isPacker === "boolean") patch.isPacker = body.isPacker;
    if (typeof body.timeoutMs === "number") patch.timeoutMs = body.timeoutMs;
    if (typeof body.maxMemoryPages === "number") patch.maxMemoryPages = body.maxMemoryPages;
    const updated = await scriptRegistry.update(id, patch);
    if (updated === null) {
      return reply.code(404).send({ error: `script ${id} not found after update` });
    }
    return updated;
  });

  /** POST /api/scripts/:id/enable */
  app.post<{ Params: { id: string } }>("/api/scripts/:id/enable", async (request, reply) => {
    const { id } = request.params;
    const ok = await scriptRegistry.setEnabled(id, true);
    if (!ok) {
      return reply.code(404).send({ error: `script ${id} not found` });
    }
    return { ok: true, enabled: true };
  });

  /** POST /api/scripts/:id/disable */
  app.post<{ Params: { id: string } }>("/api/scripts/:id/disable", async (request, reply) => {
    const { id } = request.params;
    const ok = await scriptRegistry.setEnabled(id, false);
    if (!ok) {
      return reply.code(404).send({ error: `script ${id} not found` });
    }
    return { ok: true, enabled: false };
  });

  /** DELETE /api/scripts/:id */
  app.delete<{ Params: { id: string } }>("/api/scripts/:id", async (request, reply) => {
    const existing = await scriptRegistry.get(request.params.id);
    if (existing === null) {
      return reply.code(404).send({ error: `script ${request.params.id} not found` });
    }
    await scriptRegistry.delete(request.params.id);
    return reply.code(204).send();
  });

  /**
   * POST /api/scripts/:id/compile
   * Phase D — encode Starlark source as UTF-8 bytes, store as wasmB64.
   * The starlark-eval.wasm interpreter runs the source at invocation time;
   * "compile" here means validate + package so the script is execution-ready.
   */
  app.post<{ Params: { id: string } }>("/api/scripts/:id/compile", async (request, reply) => {
    const { id } = request.params;
    const existing = await scriptRegistry.get(id);
    if (existing === null) {
      return reply.code(404).send({ error: `script ${id} not found` });
    }
    if (existing.source === null || existing.source.trim().length === 0) {
      return reply.code(422).send({
        error: "Script has no source code to compile",
        scriptId: id,
        scriptName: existing.name,
      });
    }

    const sourceBytes = new TextEncoder().encode(existing.source);
    const wasmB64 = Buffer.from(sourceBytes).toString("base64");
    const sourceHash = sha256Hex(existing.source);
    const wasmHash = sha256Hex(sourceBytes);

    const compiled = await scriptRegistry.setCompiled(id, wasmB64, wasmHash, sourceHash);
    if (compiled === null) {
      return reply.code(404).send({ error: `script ${id} not found after compile` });
    }
    return compiled;
  });
}
