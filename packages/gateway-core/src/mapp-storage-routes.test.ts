import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMAppStorageRoutes } from "./mapp-storage-routes.js";

/**
 * Unit tests for s140 t599 phase 3 — MApp storage API.
 *
 * Each test sets up a workspace tmpdir with a single project named
 * `proofing` (matches the per-spec hostname slug rules). The Fastify
 * app is registered against that workspace; inject() exercises the
 * route handlers without binding a port.
 */

function makeApp() {
  const root = mkdtempSync(join(tmpdir(), "mapp-storage-test-"));
  const projectsRoot = join(root, "projects");
  const projectPath = join(projectsRoot, "proofing");
  mkdirSync(projectPath, { recursive: true });

  const app = Fastify({ logger: false });
  registerMAppStorageRoutes(app, { workspaceProjects: [projectsRoot] });

  return { app, root, projectPath, projectsRoot };
}

describe("mapp-storage-routes — sandbox area", () => {
  let app: Awaited<ReturnType<typeof makeApp>>["app"];
  let root: string;
  let projectPath: string;

  beforeEach(() => {
    const made = makeApp();
    app = made.app;
    root = made.root;
    projectPath = made.projectPath;
  });

  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("PUT writes JSON content to disk and GET reads it back identically", async () => {
    const payload = { value: "hello", n: 42 };
    const put = await app.inject({
      method: "PUT",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/state.json",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(put.statusCode).toBe(200);
    const putJson = put.json() as { area: string; mappId: string; path: string; bytes: number };
    expect(putJson.area).toBe("sandbox");
    expect(putJson.mappId).toBe("admin-editor");
    expect(putJson.path).toBe("state.json");
    expect(putJson.bytes).toBeGreaterThan(0);

    // Verify the file landed on disk inside the project's sandbox tree.
    const onDisk = join(projectPath, "sandbox", "mapps", "admin-editor", "state.json");
    expect(existsSync(onDisk)).toBe(true);
    expect(JSON.parse(readFileSync(onDisk, "utf-8"))).toEqual(payload);

    const get = await app.inject({
      method: "GET",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/state.json",
    });
    expect(get.statusCode).toBe(200);
    expect(JSON.parse(get.body)).toEqual(payload);
  });

  it("GET on the bare mapp dir lists file entries", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/a.json",
      headers: { "content-type": "application/json" },
      payload: { x: 1 },
    });
    await app.inject({
      method: "PUT",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/b.json",
      headers: { "content-type": "application/json" },
      payload: { x: 2 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { area: string; mappId: string; entries: { name: string; kind: string }[] };
    expect(body.entries.map((e) => e.name).sort()).toEqual(["a.json", "b.json"]);
    expect(body.entries.every((e) => e.kind === "file")).toBe(true);
  });

  it("DELETE removes the file and subsequent GET returns 404", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/x.json",
      headers: { "content-type": "application/json" },
      payload: { v: 1 },
    });

    const del = await app.inject({
      method: "DELETE",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/x.json",
    });
    expect(del.statusCode).toBe(200);

    const get = await app.inject({
      method: "GET",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/x.json",
    });
    expect(get.statusCode).toBe(404);
  });

  it("rejects filepath containing .. path-traversal segment with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/..%2Fpasswd",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects mappId with capital letters or unsafe chars with 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/proofing/sandbox/mapps/Admin-Editor/x.json",
      headers: { "content-type": "application/json" },
      payload: { v: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for unknown project slug", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/no_such_project/sandbox/mapps/admin-editor/x.json",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for missing files under a known mapp", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/proofing/sandbox/mapps/admin-editor/never-written.json",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("mapp-storage-routes — k area (persistent)", () => {
  it("isolates k/mapps from sandbox/mapps even with the same mappId", async () => {
    const made = makeApp();
    try {
      await made.app.inject({
        method: "PUT",
        url: "/api/projects/proofing/k/mapps/admin-editor/persistent.json",
        headers: { "content-type": "application/json" },
        payload: { area: "k" },
      });

      // Write a different value to the same filename in sandbox.
      await made.app.inject({
        method: "PUT",
        url: "/api/projects/proofing/sandbox/mapps/admin-editor/persistent.json",
        headers: { "content-type": "application/json" },
        payload: { area: "sandbox" },
      });

      const kRes = await made.app.inject({
        method: "GET",
        url: "/api/projects/proofing/k/mapps/admin-editor/persistent.json",
      });
      const sRes = await made.app.inject({
        method: "GET",
        url: "/api/projects/proofing/sandbox/mapps/admin-editor/persistent.json",
      });
      expect(JSON.parse(kRes.body)).toEqual({ area: "k" });
      expect(JSON.parse(sRes.body)).toEqual({ area: "sandbox" });
    } finally {
      await made.app.close();
      rmSync(made.root, { recursive: true, force: true });
    }
  });
});
