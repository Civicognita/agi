/**
 * vault/api — REST surface for the Vault feature (s128 t494).
 *
 * Endpoints (all gated on private-network + admin role):
 *   GET    /api/vault           — list summaries (path-leakage-safe projection)
 *   POST   /api/vault           — create entry
 *   GET    /api/vault/:id       — read entry { entry, value }
 *   DELETE /api/vault/:id       — delete entry
 *
 * Path-scoping rules:
 *   - List: returns ALL entries' summaries; the projection's `ownedByProject`
 *     boolean reflects whether the requesting project owns the entry. Cross-
 *     project name discovery is intentional (the dashboard's vault tab needs
 *     to see all entries to render the global picker), but values are NOT
 *     leaked at the list endpoint.
 *   - Read: returns the value ONLY when the entry is gateway-scoped
 *     (owningProject === null) OR when the requestingProject query
 *     parameter matches the entry's owningProject. Otherwise returns 403.
 *
 * Admin-role gate: same pattern as `/api/projects/*` — request must come
 * from a private-network address; future cycles can add per-route admin
 * authentication via the entity-tier system.
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { isAbsolute } from "node:path";
import {
  parseVaultEntry,
  summarizeVaultEntry,
  VAULT_ENTRY_TYPES,
  type VaultEntryCreate,
  type VaultEntrySummary,
} from "./types.js";
import type { VaultStorage } from "./storage.js";

// ---------------------------------------------------------------------------
// Private-network gate (mirrors onboarding-api / server-runtime-state)
// ---------------------------------------------------------------------------

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isPrivateNetwork(ip: string): boolean {
  if (isLoopback(ip)) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  // RFC 1918 + link-local — same shape as onboarding-api / server-runtime-state.
  if (v4.startsWith("10.")) return true;
  if (v4.startsWith("192.168.")) return true;
  if (v4.startsWith("169.254.")) return true;
  if (v4.startsWith("172.")) {
    const second = parseInt(v4.split(".")[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function getClientIp(req: IncomingMessage & { ip?: string }): string {
  if (typeof req.ip === "string" && req.ip.length > 0) return req.ip;
  return req.socket.remoteAddress ?? "0.0.0.0";
}

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

function validateCreateBody(body: unknown): { ok: true; value: VaultEntryCreate } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be an object" };
  }
  const obj = body as Record<string, unknown>;

  const name = obj["name"];
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, error: 'field "name" must be a non-empty string' };
  }

  const type = obj["type"];
  if (typeof type !== "string" || !VAULT_ENTRY_TYPES.includes(type as (typeof VAULT_ENTRY_TYPES)[number])) {
    return { ok: false, error: `field "type" must be one of ${VAULT_ENTRY_TYPES.join("|")}` };
  }

  const value = obj["value"];
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, error: 'field "value" must be a non-empty string' };
  }

  const owningRaw = obj["owningProject"];
  let owningProject: string | undefined;
  if (owningRaw === undefined || owningRaw === null) {
    owningProject = undefined;
  } else if (typeof owningRaw === "string" && owningRaw.length > 0 && isAbsolute(owningRaw)) {
    owningProject = owningRaw;
  } else {
    return { ok: false, error: 'field "owningProject" must be an absolute path or omitted' };
  }

  const descRaw = obj["description"];
  let description: string | undefined;
  if (descRaw === undefined) {
    description = undefined;
  } else if (typeof descRaw === "string") {
    description = descRaw.length > 0 ? descRaw : undefined;
  } else {
    return { ok: false, error: 'field "description" must be a string or omitted' };
  }

  return {
    ok: true,
    value: {
      name,
      type: type as (typeof VAULT_ENTRY_TYPES)[number],
      value,
      ...(owningProject !== undefined ? { owningProject } : {}),
      ...(description !== undefined ? { description } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface VaultApiDeps {
  vaultStorage: VaultStorage;
}

export function registerVaultRoutes(app: FastifyInstance, deps: VaultApiDeps): void {
  const requirePrivateNetwork = (req: { raw: IncomingMessage & { ip?: string } }): string | null => {
    const clientIp = getClientIp(req.raw);
    if (!isPrivateNetwork(clientIp)) return "Vault API only allowed from private network";
    return null;
  };

  /**
   * GET /api/vault — list entry summaries.
   *
   * Query parameters:
   *   - `requestingProject` (optional): absolute path of the calling project.
   *     When supplied, summary `ownedByProject` is true for entries with
   *     matching owningProject. When omitted, all entries report
   *     ownedByProject=false (cross-project view).
   */
  app.get<{ Querystring: { requestingProject?: string } }>("/api/vault", async (request, reply) => {
    const denial = requirePrivateNetwork(request);
    if (denial !== null) return reply.code(403).send({ error: denial });

    const requestingProject = request.query.requestingProject;
    if (requestingProject !== undefined && !isAbsolute(requestingProject)) {
      return reply.code(400).send({ error: '"requestingProject" must be an absolute path' });
    }

    const entries = deps.vaultStorage.list();
    const summaries: VaultEntrySummary[] = entries.map((e) => summarizeVaultEntry(e, requestingProject));
    return reply.send({ entries: summaries });
  });

  /** POST /api/vault — create a new entry. */
  app.post<{ Body: unknown }>("/api/vault", async (request, reply) => {
    const denial = requirePrivateNetwork(request);
    if (denial !== null) return reply.code(403).send({ error: denial });

    const validation = validateCreateBody(request.body);
    if (!validation.ok) return reply.code(400).send({ error: validation.error });

    const entry = await deps.vaultStorage.create(validation.value);
    // Return the summary — never echo the value back. The caller already
    // has the value (they POSTed it); the response confirms persistence
    // without re-leaking the secret.
    return reply.code(201).send({
      entry: summarizeVaultEntry(entry, validation.value.owningProject),
    });
  });

  /**
   * GET /api/vault/:id — read entry { entry, value }.
   *
   * Project-scoping enforcement:
   *   - Gateway-scoped entries (owningProject === null): readable by anyone
   *     on the private network.
   *   - Project-scoped entries: caller must supply ?requestingProject=<path>
   *     matching the entry's owningProject; mismatch returns 403.
   *
   * The returned `entry` field is the FULL VaultEntry (not the summary)
   * because the caller is authorized to see the value; withholding the
   * `owningProject` field would just be theatre at this point.
   */
  app.get<{ Params: { id: string }; Querystring: { requestingProject?: string } }>(
    "/api/vault/:id",
    async (request, reply) => {
      const denial = requirePrivateNetwork(request);
      if (denial !== null) return reply.code(403).send({ error: denial });

      const id = request.params.id;
      const requestingProject = request.query.requestingProject;
      if (requestingProject !== undefined && !isAbsolute(requestingProject)) {
        return reply.code(400).send({ error: '"requestingProject" must be an absolute path' });
      }

      const result = await deps.vaultStorage.read(id);
      if (result === null) return reply.code(404).send({ error: "vault entry not found" });

      // Project-scoped enforcement: deny when entry owns a project AND
      // requestingProject mismatches.
      if (result.entry.owningProject !== null && result.entry.owningProject !== requestingProject) {
        return reply.code(403).send({
          error: "vault entry is owned by a different project; supply matching ?requestingProject",
        });
      }

      return reply.send({ entry: result.entry, value: result.value });
    },
  );

  /** DELETE /api/vault/:id — delete entry. Returns 200 with deleted=true
   *  on success, 404 when no entry matched. Project-scoped entries follow
   *  the same authorization rule as GET /api/vault/:id. */
  app.delete<{ Params: { id: string }; Querystring: { requestingProject?: string } }>(
    "/api/vault/:id",
    async (request, reply) => {
      const denial = requirePrivateNetwork(request);
      if (denial !== null) return reply.code(403).send({ error: denial });

      const id = request.params.id;
      const requestingProject = request.query.requestingProject;
      if (requestingProject !== undefined && !isAbsolute(requestingProject)) {
        return reply.code(400).send({ error: '"requestingProject" must be an absolute path' });
      }

      // Pre-check ownership before delete so callers can't enumerate
      // existence of project-scoped entries owned by another project.
      const meta = deps.vaultStorage.readMetadata(id);
      if (meta === null) return reply.code(404).send({ error: "vault entry not found" });
      if (meta.owningProject !== null && meta.owningProject !== requestingProject) {
        return reply.code(403).send({
          error: "vault entry is owned by a different project; supply matching ?requestingProject",
        });
      }

      const deleted = await deps.vaultStorage.delete(id);
      return reply.send({ deleted });
    },
  );

  // Re-export for stable exports + consumer-side type imports without
  // forcing the validation helper to re-implement the parser.
  void parseVaultEntry;
}
