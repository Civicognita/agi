/**
 * Skills Discovery Tests for bundled skill files
 *
 * Verifies that the skill files in packages/skills/src/skills/ can be
 * found by SkillRegistry.discover() and have valid frontmatter.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SkillRegistry, parseSkillFile } from "./discovery.js";

// Resolve the skills directory relative to this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILLS_DIR = resolve(__dirname, "skills");

// ---------------------------------------------------------------------------
// Discovery: bundled skill files
// ---------------------------------------------------------------------------

describe("SkillRegistry.discover() — bundled skill files", () => {
  it("discovers the skills directory without errors", () => {
    const registry = new SkillRegistry({ skillDirs: [SKILLS_DIR] });
    const result = registry.discover();

    // All bundled skills should load without errors
    expect(result.errors).toHaveLength(0);
  });

  it("loads at least 3 skills from the bundled skills directory", () => {
    const registry = new SkillRegistry({ skillDirs: [SKILLS_DIR] });
    const result = registry.discover();

    expect(result.loaded).toBeGreaterThanOrEqual(3);
    expect(registry.validCount).toBeGreaterThanOrEqual(3);
  });

  it("loads all bundled skills as valid", () => {
    const registry = new SkillRegistry({ skillDirs: [SKILLS_DIR] });
    registry.discover();

    const all = registry.getAll();
    for (const skill of all) {
      expect(skill.valid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Individual skill file validation
// ---------------------------------------------------------------------------

describe("greeting.skill.md — valid frontmatter", () => {
  it("parses name as 'greeting'", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "greeting.skill.md"));
    expect(def.name).toBe("greeting");
  });

  it("has a non-empty description", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "greeting.skill.md"));
    expect(def.description.length).toBeGreaterThan(0);
  });

  it("has at least one trigger pattern", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "greeting.skill.md"));
    expect(def.triggers.length).toBeGreaterThan(0);
    expect(def.compiledTriggers.length).toBeGreaterThan(0);
  });

  it("has a valid domain", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "greeting.skill.md"));
    expect(def.domain).toBeTruthy();
  });

  it("has non-empty content body", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "greeting.skill.md"));
    expect(def.content.length).toBeGreaterThan(0);
  });

  it("matches 'hello' trigger input", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "greeting.skill.md"));
    const matched = def.compiledTriggers.some((r) => r.test("hello there"));
    expect(matched).toBe(true);
  });

  it("matches 'introduce yourself' trigger input", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "greeting.skill.md"));
    const matched = def.compiledTriggers.some((r) => r.test("please introduce yourself"));
    expect(matched).toBe(true);
  });
});

describe("impact.skill.md — valid frontmatter", () => {
  it("parses name as 'impact'", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "impact.skill.md"));
    expect(def.name).toBe("impact");
  });

  it("has a non-empty description", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "impact.skill.md"));
    expect(def.description.length).toBeGreaterThan(0);
  });

  it("has at least one trigger pattern", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "impact.skill.md"));
    expect(def.triggers.length).toBeGreaterThan(0);
  });

  it("has requiresState set to [ONLINE]", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "impact.skill.md"));
    expect(def.requiresState).toEqual(["ONLINE"]);
  });

  it("has requiresTier set to 'verified'", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "impact.skill.md"));
    expect(def.requiresTier).toBe("verified");
  });

  it("has non-empty content body containing the formula", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "impact.skill.md"));
    expect(def.content).toContain("$imp");
    expect(def.content).toContain("QUANT");
  });

  it("matches 'impact score' trigger input", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "impact.skill.md"));
    const matched = def.compiledTriggers.some((r) => r.test("what is my impact score?"));
    expect(matched).toBe(true);
  });
});

describe("status.skill.md — valid frontmatter", () => {
  it("parses name as 'status'", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "status.skill.md"));
    expect(def.name).toBe("status");
  });

  it("has a non-empty description", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "status.skill.md"));
    expect(def.description.length).toBeGreaterThan(0);
  });

  it("has at least one trigger pattern", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "status.skill.md"));
    expect(def.triggers.length).toBeGreaterThan(0);
  });

  it("has no requiresTier restriction (available to all tiers)", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "status.skill.md"));
    expect(def.requiresTier).toBeUndefined();
  });

  it("has no requiresState restriction (available in all states)", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "status.skill.md"));
    // status skill should work in all states — either undefined or empty array
    expect(
      def.requiresState === undefined || def.requiresState.length === 0
    ).toBe(true);
  });

  it("has non-empty content body", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "status.skill.md"));
    expect(def.content.length).toBeGreaterThan(0);
  });

  it("matches 'status' trigger input", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "status.skill.md"));
    const matched = def.compiledTriggers.some((r) => r.test("what is your status?"));
    expect(matched).toBe(true);
  });

  it("matches 'are you online' trigger input", () => {
    const def = parseSkillFile(resolve(SKILLS_DIR, "status.skill.md"));
    const matched = def.compiledTriggers.some((r) => r.test("are you online right now?"));
    expect(matched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// All skills: common invariants
// ---------------------------------------------------------------------------

describe("All bundled skills — common invariants", () => {
  let registry: SkillRegistry;

  beforeAll(() => {
    registry = new SkillRegistry({ skillDirs: [SKILLS_DIR] });
    registry.discover();
  });

  it("every skill has a unique name", () => {
    const names = registry.getAll().map((s) => s.definition.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("every skill has compiled triggers that are RegExp instances", () => {
    for (const registered of registry.getValid()) {
      for (const trigger of registered.definition.compiledTriggers) {
        expect(trigger).toBeInstanceOf(RegExp);
      }
    }
  });

  it("every skill has a non-empty content body", () => {
    for (const registered of registry.getValid()) {
      expect(registered.definition.content.length).toBeGreaterThan(0);
    }
  });

  it("every valid skill passes parseSkillFile without throwing", () => {
    for (const registered of registry.getValid()) {
      expect(() => parseSkillFile(registered.definition.filePath)).not.toThrow();
    }
  });
});
