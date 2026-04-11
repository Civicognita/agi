import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const reqPath = join(__dirname, "..", "required-plugins.json");
const data = JSON.parse(readFileSync(reqPath, "utf-8")) as {
  plugins: Array<{ id: string; disableable?: boolean }>;
};
const ids = data.plugins.map((p) => p.id);

describe("required-plugins.json", () => {
  it("includes project type plugins", () => {
    expect(ids).toContain("project-webapp");
    expect(ids).toContain("project-api");
    expect(ids).toContain("project-staticsite");
    expect(ids).toContain("project-writing");
  });

  it("includes runtime plugins", () => {
    expect(ids).toContain("aionima-php-runtime");
    expect(ids).toContain("aionima-node-runtime");
  });

  it("includes service plugins", () => {
    expect(ids).toContain("aionima-postgres");
    expect(ids).toContain("aionima-mysql");
    expect(ids).toContain("aionima-redis");
  });

  it("includes framework stack plugins", () => {
    expect(ids).toContain("stack-laravel");
    expect(ids).toContain("stack-tall");
    expect(ids).toContain("stack-nextjs");
    expect(ids).toContain("stack-nuxt");
    expect(ids).toContain("stack-node-app");
    expect(ids).toContain("stack-php-app");
    expect(ids).toContain("stack-react-vite");
    expect(ids).toContain("stack-static-hosting");
    expect(ids).toContain("stack-hono");
  });

  it("marks all required plugins as non-disableable", () => {
    for (const p of data.plugins) {
      expect(p.disableable).toBe(false);
    }
  });
});
