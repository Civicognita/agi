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

  describe("ProjectRepoSchema runtime fields (s130 t515 cycle 123)", () => {
    it("accepts a runnable repo with port + startCommand", () => {
      const data = {
        name: "Multi-repo App",
        repos: [
          { name: "web", url: "https://example.com/web.git", port: 5173, startCommand: "pnpm dev", isDefault: true },
          { name: "api", url: "https://example.com/api.git", port: 8001, startCommand: "node dist/server.js", externalPath: "/api" },
          { name: "sdk", url: "https://example.com/sdk.git" }, // code-only, no port
        ],
      };
      const result = ProjectConfigSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects port without startCommand", () => {
      const data = {
        name: "X",
        repos: [{ name: "web", url: "u", port: 5173 }],
      };
      const r = ProjectConfigSchema.safeParse(data);
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.message.includes("startCommand is required"))).toBe(true);
      }
    });

    it("rejects externalPath without port", () => {
      const data = {
        name: "X",
        repos: [{ name: "web", url: "u", externalPath: "/api" }],
      };
      expect(ProjectConfigSchema.safeParse(data).success).toBe(false);
    });

    it("rejects isDefault without port", () => {
      const data = {
        name: "X",
        repos: [{ name: "web", url: "u", isDefault: true }],
      };
      expect(ProjectConfigSchema.safeParse(data).success).toBe(false);
    });

    it("rejects two repos with isDefault: true", () => {
      const data = {
        name: "X",
        repos: [
          { name: "web", url: "u", port: 5173, startCommand: "pnpm dev", isDefault: true },
          { name: "admin", url: "u", port: 5174, startCommand: "pnpm admin", isDefault: true },
        ],
      };
      const r = ProjectConfigSchema.safeParse(data);
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.message.includes("at most one"))).toBe(true);
      }
    });

    it("rejects two repos sharing the same port", () => {
      const data = {
        name: "X",
        repos: [
          { name: "web", url: "u", port: 5173, startCommand: "pnpm dev" },
          { name: "admin", url: "u", port: 5173, startCommand: "pnpm admin" },
        ],
      };
      const r = ProjectConfigSchema.safeParse(data);
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.message.includes("share the same port"))).toBe(true);
      }
    });

    it("rejects two repos sharing the same externalPath", () => {
      const data = {
        name: "X",
        repos: [
          { name: "a", url: "u", port: 5173, startCommand: "pnpm a", externalPath: "/api" },
          { name: "b", url: "u", port: 5174, startCommand: "pnpm b", externalPath: "/api" },
        ],
      };
      expect(ProjectConfigSchema.safeParse(data).success).toBe(false);
    });

    it("rejects malformed externalPath (must start with / and use safe chars)", () => {
      const data = {
        name: "X",
        repos: [{ name: "a", url: "u", port: 5173, startCommand: "pnpm a", externalPath: "api" }],
      };
      expect(ProjectConfigSchema.safeParse(data).success).toBe(false);
    });

    it("accepts internal-only repo (port + startCommand, no externalPath, no isDefault)", () => {
      const data = {
        name: "X",
        repos: [
          { name: "web", url: "u", port: 5173, startCommand: "pnpm dev", isDefault: true },
          { name: "worker", url: "u", port: 7000, startCommand: "pnpm worker" }, // sibling-only, no external exposure
        ],
      };
      expect(ProjectConfigSchema.safeParse(data).success).toBe(true);
    });

    it("accepts a repo with devCommand distinct from startCommand (s141 t551)", () => {
      const data = {
        name: "X",
        repos: [
          { name: "web", url: "u", port: 5173, startCommand: "node dist/server.js", devCommand: "pnpm dev", isDefault: true },
        ],
      };
      const r = ProjectConfigSchema.safeParse(data);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.repos?.[0]?.devCommand).toBe("pnpm dev");
      }
    });

    it("accepts a repo with custom actions (s141 t551)", () => {
      const data = {
        name: "X",
        repos: [
          {
            name: "api",
            url: "u",
            port: 8001,
            startCommand: "node dist",
            actions: [
              { label: "Run tests", command: "pnpm test" },
              { label: "Migrate DB", command: "drizzle-kit push", description: "Pushes the latest schema to the project's hosted Postgres" },
            ],
          },
        ],
      };
      const r = ProjectConfigSchema.safeParse(data);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.repos?.[0]?.actions?.length).toBe(2);
      }
    });

    it("rejects duplicate action labels within a repo (s141 t551)", () => {
      const data = {
        name: "X",
        repos: [
          {
            name: "api",
            url: "u",
            actions: [
              { label: "Build", command: "pnpm build" },
              { label: "Build", command: "pnpm build:dashboard" },
            ],
          },
        ],
      };
      const r = ProjectConfigSchema.safeParse(data);
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.message.includes("action labels must be unique"))).toBe(true);
      }
    });

    it("rejects empty action label (s141 t551)", () => {
      const data = {
        name: "X",
        repos: [
          {
            name: "api",
            url: "u",
            actions: [{ label: "", command: "pnpm build" }],
          },
        ],
      };
      expect(ProjectConfigSchema.safeParse(data).success).toBe(false);
    });

    it("rejects empty action command (s141 t551)", () => {
      const data = {
        name: "X",
        repos: [
          {
            name: "api",
            url: "u",
            actions: [{ label: "Build", command: "" }],
          },
        ],
      };
      expect(ProjectConfigSchema.safeParse(data).success).toBe(false);
    });

    it("accepts env vars on a repo", () => {
      const data = {
        name: "X",
        repos: [
          { name: "api", url: "u", port: 8001, startCommand: "node dist", env: { LOG_LEVEL: "info", DATABASE_URL: "postgres://..." } },
        ],
      };
      expect(ProjectConfigSchema.safeParse(data).success).toBe(true);
    });

    it("accepts autoRun=false to skip a repo from container boot", () => {
      const data = {
        name: "X",
        repos: [
          { name: "web", url: "u", port: 5173, startCommand: "pnpm dev", isDefault: true, autoRun: true },
          { name: "ondemand", url: "u", port: 9000, startCommand: "pnpm cron", autoRun: false },
        ],
      };
      const r = ProjectConfigSchema.safeParse(data);
      expect(r.success).toBe(true);
      if (r.success && r.data.repos) {
        expect(r.data.repos[1]?.autoRun).toBe(false);
      }
    });

    it("rejects autoRun set on a code-only repo (no port)", () => {
      const data = {
        name: "X",
        repos: [
          { name: "lib", url: "u", autoRun: true }, // no port — autoRun makes no sense
        ],
      };
      const r = ProjectConfigSchema.safeParse(data);
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.message.includes("autoRun only applies"))).toBe(true);
      }
    });
  });
});
