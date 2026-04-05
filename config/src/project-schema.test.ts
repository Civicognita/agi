/**
 * ProjectConfigSchema Tests — validates Zod schema for project.json.
 *
 * Uses fixture files from test/fixtures/project-configs/.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectConfigSchema, ProjectHostingSchema, ProjectStackInstanceSchema } from "./project-schema.js";

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
});
