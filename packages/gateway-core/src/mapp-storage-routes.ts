/**
 * MApp Storage routes (s140 t599 phase 3).
 *
 * Two project-scoped storage areas exposed to MApps via the gateway:
 *
 *   /api/projects/<slug>/k/mapps/<mappId>/<filepath>
 *     — persistent project knowledge files. Survives container resets.
 *       Backed by `<projectPath>/k/mapps/<mappId>/`.
 *
 *   /api/projects/<slug>/sandbox/mapps/<mappId>/<filepath>
 *     — generated/temporary content. Treated as cache-grade.
 *       Backed by `<projectPath>/sandbox/mapps/<mappId>/`.
 *
 * Both areas accept the same four verbs:
 *
 *   GET    .../<mappId>/                      → list directory entries
 *   GET    .../<mappId>/<filepath>            → read file content
 *   PUT    .../<mappId>/<filepath>            → write file content (creates dirs)
 *   DELETE .../<mappId>/<filepath>            → delete file (or empty dir)
 *
 * Path safety: slug + mappId must match `^[a-z0-9][a-z0-9_-]*$` (lowercase
 * alphanumeric, hyphens, underscores; can't start with a separator). The
 * filepath is split on `/`; segments equal to `..`, `.`, or empty are
 * rejected, as are segments containing NUL or backslash. After joining
 * we re-resolve and re-verify the result lives strictly under the base
 * directory — defense in depth.
 *
 * Phase 3 ships the gateway routes and a same-origin probe MApp can
 * call them directly via fetch. Phase 3.5 will add a postMessage IPC
 * mediation layer in the MApp Desktop runtime so cross-origin or
 * sandbox-restricted MApps don't need direct fetch access.
 */

import type { FastifyInstance } from "fastify";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve as resolvePath, sep } from "node:path";

// Reuse the collection-aware enumeration shape from server-runtime-state's
// /api/projects route — projects can live one level deep (top-level dir
// under workspaceProjects[0]) OR two levels deep (inside an
// aionima-collection wrapper at `_aionima/<slug>/`).
function resolveProjectPath(slug: string, projectDirs: string[]): string | null {
  const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
  if (!SLUG_RE.test(slug)) return null;

  for (const dir of projectDirs) {
    if (!existsSync(dir)) continue;

    // Top-level
    const direct = resolvePath(dir, slug);
    if (existsSync(direct) && statSync(direct).isDirectory()) {
      return direct;
    }

    // Look one level deeper — inside any aionima-collection wrappers.
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const wrapperPath = resolvePath(dir, entry.name);
        const collectionMarker = join(wrapperPath, "collection.json");
        if (!existsSync(collectionMarker)) continue;
        const nested = resolvePath(wrapperPath, slug);
        if (existsSync(nested) && statSync(nested).isDirectory()) {
          return nested;
        }
      }
    } catch {
      /* enumeration failed — try next dir */
    }
  }

  return null;
}

// Validate + decompose a filepath wildcard segment into safe path parts.
function safePathSegments(rawFilepath: string): string[] | null {
  if (rawFilepath.length === 0) return [];
  // Reject anything that smells like an absolute path or smuggled separator.
  if (rawFilepath.startsWith("/") || rawFilepath.includes("\\") || rawFilepath.includes("\0")) {
    return null;
  }
  const segments = rawFilepath.split("/").filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg === "." || seg === "..") return null;
    if (seg.includes("\0") || seg.includes(sep) || seg.includes("\\")) return null;
  }
  return segments;
}

// Returns the base dir (k/mapps/<mappId>/ OR sandbox/mapps/<mappId>/)
// after creating it idempotently. Returns null if mappId is unsafe.
function ensureMappBaseDir(
  projectPath: string,
  area: "k" | "sandbox",
  mappId: string,
): string | null {
  const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
  if (!SLUG_RE.test(mappId)) return null;
  const base = join(projectPath, area, "mapps", mappId);
  mkdirSync(base, { recursive: true });
  return base;
}

interface MAppStorageDeps {
  workspaceProjects?: string[];
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MiB cap per file (cycle 178 floor — relax later if a MApp needs more)

export function registerMAppStorageRoutes(fastify: FastifyInstance, deps: MAppStorageDeps): void {
  for (const area of ["k", "sandbox"] as const) {
    // -----------------------------------------------------------------
    // GET /api/projects/:slug/<area>/mapps/:mappId/  (no wildcard)
    //   → list directory entries
    // GET /api/projects/:slug/<area>/mapps/:mappId/*filepath
    //   → read file (404 if missing, 413 if oversized)
    // -----------------------------------------------------------------

    fastify.get<{ Params: { slug: string; mappId: string } }>(
      `/api/projects/:slug/${area}/mapps/:mappId/`,
      async (request, reply) => {
        const projectDirs = deps.workspaceProjects ?? [];
        const projectPath = resolveProjectPath(request.params.slug, projectDirs);
        if (projectPath === null) {
          return reply.code(404).send({ error: `unknown project slug: ${request.params.slug}` });
        }
        const base = ensureMappBaseDir(projectPath, area, request.params.mappId);
        if (base === null) {
          return reply.code(400).send({ error: `invalid mappId: ${request.params.mappId}` });
        }
        try {
          const entries = readdirSync(base, { withFileTypes: true }).map((d) => ({
            name: d.name,
            kind: d.isDirectory() ? "dir" : d.isFile() ? "file" : "other",
          }));
          return reply.send({ area, mappId: request.params.mappId, entries });
        } catch (err) {
          return reply.code(500).send({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );

    fastify.get<{ Params: { slug: string; mappId: string; "*": string } }>(
      `/api/projects/:slug/${area}/mapps/:mappId/*`,
      async (request, reply) => {
        const projectDirs = deps.workspaceProjects ?? [];
        const projectPath = resolveProjectPath(request.params.slug, projectDirs);
        if (projectPath === null) {
          return reply.code(404).send({ error: `unknown project slug: ${request.params.slug}` });
        }
        const base = ensureMappBaseDir(projectPath, area, request.params.mappId);
        if (base === null) {
          return reply.code(400).send({ error: `invalid mappId: ${request.params.mappId}` });
        }
        const segs = safePathSegments(request.params["*"]);
        if (segs === null) {
          return reply.code(400).send({ error: "unsafe filepath" });
        }
        if (segs.length === 0) {
          // Wildcard matched empty — defer to the directory-list route above.
          return reply.code(400).send({ error: "filepath required" });
        }
        const targetPath = resolvePath(base, ...segs);
        if (!targetPath.startsWith(base + sep) && targetPath !== base) {
          return reply.code(400).send({ error: "filepath escapes mapp dir" });
        }
        if (!existsSync(targetPath)) {
          return reply.code(404).send({ error: "file not found" });
        }
        const stat = statSync(targetPath);
        if (stat.isDirectory()) {
          const entries = readdirSync(targetPath, { withFileTypes: true }).map((d) => ({
            name: d.name,
            kind: d.isDirectory() ? "dir" : d.isFile() ? "file" : "other",
          }));
          return reply.send({ area, mappId: request.params.mappId, entries });
        }
        if (stat.size > MAX_FILE_BYTES) {
          return reply.code(413).send({ error: `file too large (>${String(MAX_FILE_BYTES)} bytes)` });
        }
        const content = readFileSync(targetPath);
        // Default content-type: octet-stream. Probe MApps that store JSON
        // can parse client-side; we don't try to sniff types here.
        reply.header("content-type", "application/octet-stream");
        return reply.send(content);
      },
    );

    // -----------------------------------------------------------------
    // PUT /api/projects/:slug/<area>/mapps/:mappId/*filepath
    //   → write file content (raw body), creates parent dirs
    // -----------------------------------------------------------------

    fastify.put<{ Params: { slug: string; mappId: string; "*": string } }>(
      `/api/projects/:slug/${area}/mapps/:mappId/*`,
      async (request, reply) => {
        const projectDirs = deps.workspaceProjects ?? [];
        const projectPath = resolveProjectPath(request.params.slug, projectDirs);
        if (projectPath === null) {
          return reply.code(404).send({ error: `unknown project slug: ${request.params.slug}` });
        }
        const base = ensureMappBaseDir(projectPath, area, request.params.mappId);
        if (base === null) {
          return reply.code(400).send({ error: `invalid mappId: ${request.params.mappId}` });
        }
        const segs = safePathSegments(request.params["*"]);
        if (segs === null || segs.length === 0) {
          return reply.code(400).send({ error: "unsafe or empty filepath" });
        }
        const targetPath = resolvePath(base, ...segs);
        if (!targetPath.startsWith(base + sep)) {
          return reply.code(400).send({ error: "filepath escapes mapp dir" });
        }

        // Body can be a Buffer (raw bytes), string, or an object (Fastify
        // auto-parsed JSON if content-type is application/json). We coerce
        // back to bytes for storage.
        let bytes: Buffer;
        const body = request.body;
        if (body === undefined || body === null) {
          bytes = Buffer.alloc(0);
        } else if (Buffer.isBuffer(body)) {
          bytes = body;
        } else if (typeof body === "string") {
          bytes = Buffer.from(body, "utf-8");
        } else {
          // Object — re-serialize as JSON for storage.
          bytes = Buffer.from(JSON.stringify(body), "utf-8");
        }

        if (bytes.length > MAX_FILE_BYTES) {
          return reply.code(413).send({ error: `body too large (>${String(MAX_FILE_BYTES)} bytes)` });
        }

        try {
          mkdirSync(dirname(targetPath), { recursive: true });
          writeFileSync(targetPath, bytes);
          return reply.send({ area, mappId: request.params.mappId, path: segs.join("/"), bytes: bytes.length });
        } catch (err) {
          return reply.code(500).send({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );

    // -----------------------------------------------------------------
    // DELETE /api/projects/:slug/<area>/mapps/:mappId/*filepath
    //   → remove file or empty dir; returns 404 if missing.
    // -----------------------------------------------------------------

    fastify.delete<{ Params: { slug: string; mappId: string; "*": string } }>(
      `/api/projects/:slug/${area}/mapps/:mappId/*`,
      async (request, reply) => {
        const projectDirs = deps.workspaceProjects ?? [];
        const projectPath = resolveProjectPath(request.params.slug, projectDirs);
        if (projectPath === null) {
          return reply.code(404).send({ error: `unknown project slug: ${request.params.slug}` });
        }
        const base = ensureMappBaseDir(projectPath, area, request.params.mappId);
        if (base === null) {
          return reply.code(400).send({ error: `invalid mappId: ${request.params.mappId}` });
        }
        const segs = safePathSegments(request.params["*"]);
        if (segs === null || segs.length === 0) {
          return reply.code(400).send({ error: "unsafe or empty filepath" });
        }
        const targetPath = resolvePath(base, ...segs);
        if (!targetPath.startsWith(base + sep)) {
          return reply.code(400).send({ error: "filepath escapes mapp dir" });
        }
        if (!existsSync(targetPath)) {
          return reply.code(404).send({ error: "file not found" });
        }
        try {
          rmSync(targetPath, { recursive: false, force: false });
          return reply.send({ area, mappId: request.params.mappId, path: segs.join("/"), deleted: true });
        } catch (err) {
          return reply.code(500).send({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
  }
}
