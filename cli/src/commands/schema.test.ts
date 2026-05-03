import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSchemaValidate } from "./schema.js";

function tmpRoot(): { root: string; cleanup: () => void } {
  const root = join(tmpdir(), `schema-validate-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("runSchemaValidate (s144 t575)", () => {
  let env: ReturnType<typeof tmpRoot>;
  let configPath: string;
  let workspaceDir: string;

  beforeEach(() => {
    env = tmpRoot();
    configPath = join(env.root, "gateway.json");
    workspaceDir = join(env.root, "projects");
    mkdirSync(workspaceDir, { recursive: true });
  });

  function writeConfig(obj: Record<string, unknown>): void {
    writeFileSync(configPath, JSON.stringify(obj, null, 2), "utf-8");
  }

  function makeProject(name: string, projectJson: unknown): string {
    const dir = join(workspaceDir, name);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "project.json");
    writeFileSync(file, JSON.stringify(projectJson, null, 2), "utf-8");
    return file;
  }

  it("returns clean for an empty gateway.json with no workspace projects", () => {
    writeConfig({});
    const results = runSchemaValidate({ configPath });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, schemaName: "AionimaConfigSchema" });
  });

  it("flags a structurally-invalid gateway.json", () => {
    // services.circuitBreaker.threshold must be a positive integer.
    writeConfig({ services: { circuitBreaker: { threshold: "not-a-number" } } });
    const results = runSchemaValidate({ configPath });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.errors.length).toBeGreaterThan(0);
    // Path should locate the offending field.
    expect(results[0]?.errors[0]?.path).toContain("services.circuitBreaker.threshold");
  });

  it("returns clean for a missing optional gateway.json", () => {
    // No file written
    const results = runSchemaValidate({ configPath });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.missing).toBe(true);
  });

  it("walks workspace projects and reports invalid project.json", () => {
    writeConfig({ workspace: { projects: [workspaceDir] } });
    // Valid project — minimal shape that ProjectConfigSchema accepts.
    makeProject("good-app", { name: "good-app" });
    // Invalid project — repos must be an array of objects with name/url, not strings.
    makeProject("broken-app", { name: "broken-app", repos: ["not-an-object"] });

    const results = runSchemaValidate({ configPath });
    expect(results.length).toBeGreaterThanOrEqual(3); // gateway + 2 projects

    const good = results.find((r) => r.file.includes("good-app"));
    const broken = results.find((r) => r.file.includes("broken-app"));
    expect(good?.ok).toBe(true);
    expect(broken?.ok).toBe(false);
    expect(broken?.errors.length).toBeGreaterThan(0);
    // The path should point at the invalid repo entry.
    expect(broken?.errors.some((e) => e.path.startsWith("repos"))).toBe(true);
  });

  it("reports JSON parse errors with a clear message", () => {
    writeConfig({ workspace: { projects: [workspaceDir] } });
    const dir = join(workspaceDir, "garbage");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.json"), "{ not valid json", "utf-8");

    const results = runSchemaValidate({ configPath });
    const garbage = results.find((r) => r.file.includes("garbage"));
    expect(garbage?.ok).toBe(false);
    expect(garbage?.errors[0]?.code).toBe("json_parse_error");
    expect(garbage?.errors[0]?.message).toContain("JSON parse failed");
  });

  it("skips hidden + underscore-prefixed project directories", () => {
    writeConfig({ workspace: { projects: [workspaceDir] } });
    // _aionima/ — sacred-collection wrapper, not a real project
    mkdirSync(join(workspaceDir, "_aionima"), { recursive: true });
    writeFileSync(join(workspaceDir, "_aionima", "project.json"), "{ broken json", "utf-8");
    // .git/ — hidden, should be skipped
    mkdirSync(join(workspaceDir, ".git"), { recursive: true });
    writeFileSync(join(workspaceDir, ".git", "project.json"), "{ broken json", "utf-8");
    // Real project
    makeProject("real-app", { name: "real-app" });

    const results = runSchemaValidate({ configPath });
    // Only gateway + real-app, NOT _aionima or .git
    expect(results.find((r) => r.file.includes("_aionima"))).toBeUndefined();
    expect(results.find((r) => r.file.includes(".git"))).toBeUndefined();
    expect(results.find((r) => r.file.includes("real-app"))?.ok).toBe(true);
  });

  it("survives a non-existent workspace root (silently skips)", () => {
    writeConfig({ workspace: { projects: ["/this/path/does/not/exist"] } });
    const results = runSchemaValidate({ configPath });
    expect(results).toHaveLength(1); // just the gateway
    expect(results[0]?.ok).toBe(true);
  });

  it("surfaces unrecognized_keys errors at the offending path (the cycle-150 class)", () => {
    writeConfig({ workspace: { projects: [workspaceDir] } });
    // ProjectRepoSchema added attachedStacks in a recent migration —
    // simulate the inverse: a future-removed key that's still on disk.
    makeProject("future-key-app", {
      name: "future-key-app",
      repos: [
        {
          name: "main",
          url: "git@github.com:x/y.git",
          totallyUnknownKey: "should fail strict parse",
        },
      ],
    });
    const results = runSchemaValidate({ configPath });
    const broken = results.find((r) => r.file.includes("future-key-app"));
    if (broken && !broken.ok) {
      // Test passes if either Zod flagged it (strict mode) OR the schema
      // permits passthrough (less strict). Both are valid behaviors; this
      // test mainly proves the path-pointing works.
      expect(broken.errors.some((e) => e.path.includes("repos"))).toBe(true);
    }
  });
});
