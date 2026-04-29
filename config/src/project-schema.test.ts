/**
 * ProjectConfigSchema Tests — validates Zod schema for project.json.
 *
 * Uses fixture files from test/fixtures/project-configs/.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectConfigSchema, ProjectHostingSchema, ProjectStackInstanceSchema, ProjectRepoSchema } from "./project-schema.js";

const FIXTURES = join(__dirname, "../../test/fixtures/project-configs");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));
}

describe("ProjectConfigSchema", () => {
  it("parses valid minimal config", () => {
    const data = loadFixture("valid-minimal.json");
    const result = ProjectConfigSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("test-project");
      expect(result.data.createdAt).toBe("2026-04-01T00:00:00.000Z");
    }
  });

  it("parses valid full config with hosting and stacks", () => {
    const data = loadFixture("valid-full.json");
    const result = ProjectConfigSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("full-project");
      expect(result.data.hosting?.enabled).toBe(true);
      expect(result.data.hosting?.type).toBe("web-app");
      expect(result.data.hosting?.stacks).toHaveLength(2);
      expect(result.data.hosting?.stacks[0]?.stackId).toBe("stack-node-app");
      expect(result.data.hosting?.stacks[1]?.databaseName).toBe("fulldb");
    }
  });

  it("preserves plugin passthrough keys", () => {
    const data = loadFixture("valid-with-plugin-data.json");
    const result = ProjectConfigSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      // .passthrough() keeps unknown root keys
      expect((result.data as Record<string, unknown>).customPluginKey).toBe("some-value");
      expect((result.data as Record<string, unknown>).anotherPlugin).toEqual({ nested: true });
    }
  });

  it("rejects config missing required name field", () => {
    const data = loadFixture("invalid-missing-name.json");
    const result = ProjectConfigSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects invalid hosting mode", () => {
    const data = loadFixture("invalid-bad-hosting.json");
    const result = ProjectConfigSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("defaults hosting stacks to empty array", () => {
    const data = {
      name: "no-stacks",
      hosting: {
        enabled: true,
        type: "static",
        hostname: "test",
      },
    };
    const result = ProjectHostingSchema.safeParse(data.hosting);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stacks).toEqual([]);
    }
  });

  it("validates stack instance schema", () => {
    const valid = { stackId: "stack-node-app", addedAt: "2026-04-01T00:00:00.000Z" };
    expect(ProjectStackInstanceSchema.safeParse(valid).success).toBe(true);

    const withDb = { ...valid, databaseName: "mydb", databaseUser: "user", databasePassword: "pass" };
    expect(ProjectStackInstanceSchema.safeParse(withDb).success).toBe(true);

    const invalid = { addedAt: "2026-04-01T00:00:00.000Z" }; // missing stackId
    expect(ProjectStackInstanceSchema.safeParse(invalid).success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // s130 phase B (t515) — multi-repo `repos` field
  // -------------------------------------------------------------------------

  describe("ProjectRepoSchema (s130 t515)", () => {
    it("parses minimal repo entry (name + url)", () => {
      const valid = { name: "web", url: "https://github.com/org/web.git" };
      expect(ProjectRepoSchema.safeParse(valid).success).toBe(true);
    });

    it("parses full repo entry with branch + path + writable", () => {
      const valid = {
        name: "api",
        url: "git@github.com:org/api.git",
        branch: "dev",
        path: "/custom/checkout/path",
        writable: true,
      };
      const result = ProjectRepoSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.writable).toBe(true);
      }
    });

    it("defaults writable to false (read-only per Q-5 owner answer)", () => {
      const valid = { name: "sdk", url: "owner/sdk" };
      const result = ProjectRepoSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.writable).toBe(false);
      }
    });

    it("rejects names with filesystem-unsafe characters", () => {
      const invalid = { name: "web/api", url: "https://x.com/repo.git" };
      expect(ProjectRepoSchema.safeParse(invalid).success).toBe(false);
    });

    it("rejects names with spaces", () => {
      const invalid = { name: "my project", url: "https://x.com/repo.git" };
      expect(ProjectRepoSchema.safeParse(invalid).success).toBe(false);
    });

    it("accepts names with hyphens, underscores, digits", () => {
      for (const name of ["web-1", "api_v2", "web", "_internal", "Repo123"]) {
        expect(ProjectRepoSchema.safeParse({ name, url: "x" }).success).toBe(true);
      }
    });

    it("requires both name and url", () => {
      expect(ProjectRepoSchema.safeParse({ name: "web" }).success).toBe(false);
      expect(ProjectRepoSchema.safeParse({ url: "x" }).success).toBe(false);
      expect(ProjectRepoSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("ProjectConfigSchema with repos array (s130 t515)", () => {
    it("accepts repos array on root", () => {
      const data = {
        name: "Multi-repo App",
        repos: [
          { name: "web", url: "https://github.com/org/web.git" },
          { name: "api", url: "https://github.com/org/api.git", branch: "dev" },
          { name: "sdk", url: "https://github.com/org/sdk.git", writable: true },
        ],
      };
      const result = ProjectConfigSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repos).toHaveLength(3);
      }
    });

    it("repos array is optional — single-repo projects work without it", () => {
      const data = { name: "Single-repo App" };
      const result = ProjectConfigSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repos).toBeUndefined();
      }
    });

    it("rejects malformed repo entries inside the array", () => {
      const data = {
        name: "Bad",
        repos: [{ name: "web/bad", url: "x" }], // bad name
      };
      expect(ProjectConfigSchema.safeParse(data).success).toBe(false);
    });
  });
});
