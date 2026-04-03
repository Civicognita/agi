/**
 * Skills package — comprehensive tests
 * Covers: discovery.ts, loader.ts, cli.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SkillRegistry, parseSkillContent } from "./discovery.js";
import {
  matchSkills,
  matchByName,
  buildSkillInjection,
  getAvailableSkills,
  filterByDomain,
} from "./loader.js";
import {
  listSkills,
  validateSkill,
  testSkillMatch,
  formatSkillSummary,
} from "./cli.js";
import type { SkillFilterContext } from "./types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build a well-formed .skill.md string. */
function makeSkillContent({
  name = "test-skill",
  description = "A test skill",
  domain = "utility",
  triggers = ["\\btest\\b"],
  requiresState,
  requiresTier,
  priority = 0,
  directInvoke = true,
  body = "Skill body content here.",
}: {
  name?: string;
  description?: string;
  domain?: string;
  triggers?: string[];
  requiresState?: string[];
  requiresTier?: string;
  priority?: number;
  directInvoke?: boolean;
  body?: string;
} = {}): string {
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `domain: ${domain}`,
  ];

  if (triggers.length > 0) {
    lines.push("triggers:");
    for (const t of triggers) {
      lines.push(`  - "${t}"`);
    }
  } else {
    lines.push("triggers: []");
  }

  if (requiresState !== undefined) {
    lines.push(`requires_state: [${requiresState.join(", ")}]`);
  }
  if (requiresTier !== undefined) {
    lines.push(`requires_tier: ${requiresTier}`);
  }

  lines.push(`priority: ${String(priority)}`);
  lines.push(`direct_invoke: ${String(directInvoke)}`);
  lines.push("---");
  lines.push(body);

  return lines.join("\n");
}

/** Default online/unverified filter context. */
const ONLINE_CTX: SkillFilterContext = { state: "ONLINE", entityTier: "unverified" };
const VERIFIED_CTX: SkillFilterContext = { state: "ONLINE", entityTier: "verified" };
const SEALED_CTX: SkillFilterContext = { state: "ONLINE", entityTier: "sealed" };
const OFFLINE_CTX: SkillFilterContext = { state: "OFFLINE", entityTier: "unverified" };

// ---------------------------------------------------------------------------
// 1. SkillRegistry / discovery (discovery.ts)
// ---------------------------------------------------------------------------

describe("parseSkillContent — valid YAML frontmatter + body", () => {
  it("parses name, description, domain", () => {
    const raw = makeSkillContent({ name: "my-skill", description: "Does something", domain: "impact" });
    const def = parseSkillContent(raw, "/fake/my-skill.skill.md");
    expect(def.name).toBe("my-skill");
    expect(def.description).toBe("Does something");
    expect(def.domain).toBe("impact");
  });

  it("parses trigger strings into compiledTriggers", () => {
    const raw = makeSkillContent({ triggers: ["\\bimpact\\b", "\\$imp"] });
    const def = parseSkillContent(raw, "/fake/x.skill.md");
    expect(def.triggers).toHaveLength(2);
    expect(def.compiledTriggers).toHaveLength(2);
    expect(def.compiledTriggers[0]).toBeInstanceOf(RegExp);
    expect(def.compiledTriggers[1]).toBeInstanceOf(RegExp);
  });

  it("parses priority as a number", () => {
    const raw = makeSkillContent({ priority: 42 });
    const def = parseSkillContent(raw, "/fake/x.skill.md");
    expect(def.priority).toBe(42);
  });

  it("parses directInvoke as boolean", () => {
    const raw = makeSkillContent({ directInvoke: false });
    const def = parseSkillContent(raw, "/fake/x.skill.md");
    expect(def.directInvoke).toBe(false);
  });

  it("parses requires_state as array", () => {
    const raw = makeSkillContent({ requiresState: ["ONLINE", "LIMBO"] });
    const def = parseSkillContent(raw, "/fake/x.skill.md");
    expect(def.requiresState).toEqual(["ONLINE", "LIMBO"]);
  });

  it("parses requires_tier", () => {
    const raw = makeSkillContent({ requiresTier: "verified" });
    const def = parseSkillContent(raw, "/fake/x.skill.md");
    expect(def.requiresTier).toBe("verified");
  });

  it("trims the body and stores it as content", () => {
    const raw = makeSkillContent({ body: "  \n  Hello World  \n  " });
    const def = parseSkillContent(raw, "/fake/x.skill.md");
    expect(def.content).toBe("Hello World");
  });

  it("uses filename as fallback name when name is absent", () => {
    // Build frontmatter without a name field
    const raw = [
      "---",
      "description: No name field",
      "domain: utility",
      'triggers: ["\\\\bfoo\\\\b"]',
      "priority: 0",
      "direct_invoke: true",
      "---",
      "body",
    ].join("\n");
    const def = parseSkillContent(raw, "/fake/fallback-name.skill.md");
    expect(def.name).toBe("fallback-name");
  });

  it("stores the file path on the definition", () => {
    const raw = makeSkillContent();
    const def = parseSkillContent(raw, "/absolute/path/to/my.skill.md");
    expect(def.filePath).toBe("/absolute/path/to/my.skill.md");
  });
});

describe("parseSkillContent — missing frontmatter throws", () => {
  it("throws when there is no YAML block at all", () => {
    expect(() => parseSkillContent("just plain text", "/fake/x.skill.md")).toThrow(
      "Missing YAML frontmatter",
    );
  });

  it("throws when frontmatter delimiters are absent (body only)", () => {
    const raw = "name: thing\ndescription: nope";
    expect(() => parseSkillContent(raw, "/fake/x.skill.md")).toThrow(
      "Missing YAML frontmatter",
    );
  });
});

describe("parseSkillContent — invalid trigger regex throws", () => {
  it("throws for an unclosed character class", () => {
    const raw = makeSkillContent({ triggers: ["[invalid"] });
    expect(() => parseSkillContent(raw, "/fake/x.skill.md")).toThrow(
      "Invalid trigger regex",
    );
  });

  it("error message includes the bad pattern", () => {
    const bad = "[unclosed";
    const raw = makeSkillContent({ triggers: [bad] });
    let msg = "";
    try {
      parseSkillContent(raw, "/fake/x.skill.md");
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(msg).toContain(bad);
  });
});

describe("parseSkillContent — missing description throws", () => {
  it("throws when description is empty string", () => {
    const raw = makeSkillContent({ description: "" });
    expect(() => parseSkillContent(raw, "/fake/x.skill.md")).toThrow(
      "Missing required field: description",
    );
  });

  it("throws when description field is omitted entirely", () => {
    const raw = [
      "---",
      "name: no-desc",
      "domain: utility",
      'triggers: ["\\\\btest\\\\b"]',
      "priority: 0",
      "direct_invoke: true",
      "---",
      "body text",
    ].join("\n");
    expect(() => parseSkillContent(raw, "/fake/x.skill.md")).toThrow(
      "Missing required field: description",
    );
  });
});

// ---------------------------------------------------------------------------
// Discovery (file-based)
// ---------------------------------------------------------------------------

describe("SkillRegistry.discover()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aionima-skills-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds .skill.md files and loads them", () => {
    writeFileSync(join(tmpDir, "alpha.skill.md"), makeSkillContent({ name: "alpha", description: "Alpha skill" }));
    writeFileSync(join(tmpDir, "beta.skill.md"), makeSkillContent({ name: "beta", description: "Beta skill" }));

    const registry = new SkillRegistry({ skillDirs: [tmpDir] });
    const result = registry.discover();

    expect(result.loaded).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(registry.count).toBe(2);
    expect(registry.validCount).toBe(2);
  });

  it("ignores files that do not end in .skill.md", () => {
    writeFileSync(join(tmpDir, "alpha.skill.md"), makeSkillContent({ name: "alpha", description: "Alpha" }));
    writeFileSync(join(tmpDir, "notes.md"), "# Not a skill file");
    writeFileSync(join(tmpDir, "alpha.json"), "{}");

    const registry = new SkillRegistry({ skillDirs: [tmpDir] });
    const result = registry.discover();

    expect(result.loaded).toBe(1);
  });

  it("registers invalid files as invalid skill entries (no crash)", () => {
    writeFileSync(join(tmpDir, "broken.skill.md"), "no frontmatter at all");

    const registry = new SkillRegistry({ skillDirs: [tmpDir] });
    const result = registry.discover();

    expect(result.loaded).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toBeTruthy();

    // Still registered, but invalid
    expect(registry.count).toBe(1);
    expect(registry.validCount).toBe(0);

    const registered = registry.get("broken");
    expect(registered).toBeDefined();
    expect(registered!.valid).toBe(false);
    expect(registered!.error).toBeTruthy();
  });

  it("does not crash when a skill directory does not exist", () => {
    const registry = new SkillRegistry({ skillDirs: ["/nonexistent/path/xyz"] });
    const result = registry.discover();

    expect(result.loaded).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles multiple skill directories", () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), "aionima-skills-test2-"));
    try {
      writeFileSync(join(tmpDir, "skill-a.skill.md"), makeSkillContent({ name: "skill-a", description: "Skill A" }));
      writeFileSync(join(tmpDir2, "skill-b.skill.md"), makeSkillContent({ name: "skill-b", description: "Skill B" }));

      const registry = new SkillRegistry({ skillDirs: [tmpDir, tmpDir2] });
      const result = registry.discover();

      expect(result.loaded).toBe(2);
      expect(registry.count).toBe(2);
    } finally {
      rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Registry accessors
// ---------------------------------------------------------------------------

describe("SkillRegistry accessors", () => {
  let tmpDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aionima-skills-acc-"));
    writeFileSync(join(tmpDir, "good.skill.md"), makeSkillContent({ name: "good", description: "Good skill" }));
    writeFileSync(join(tmpDir, "bad.skill.md"), "not a skill");

    registry = new SkillRegistry({ skillDirs: [tmpDir] });
    registry.discover();
  });

  afterEach(() => {
    registry.destroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("count returns total skill count (valid + invalid)", () => {
    expect(registry.count).toBe(2);
  });

  it("validCount returns only valid skill count", () => {
    expect(registry.validCount).toBe(1);
  });

  it("getAll() returns all registered skills", () => {
    const all = registry.getAll();
    expect(all).toHaveLength(2);
  });

  it("getValid() returns only valid skills", () => {
    const valid = registry.getValid();
    expect(valid).toHaveLength(1);
    expect(valid[0]!.valid).toBe(true);
  });

  it("get(name) returns a registered skill by name", () => {
    const skill = registry.get("good");
    expect(skill).toBeDefined();
    expect(skill!.definition.name).toBe("good");
  });

  it("get(name) returns undefined for unregistered name", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// recordMatch
// ---------------------------------------------------------------------------

describe("SkillRegistry.recordMatch()", () => {
  let tmpDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aionima-skills-match-"));
    writeFileSync(join(tmpDir, "tracker.skill.md"), makeSkillContent({ name: "tracker", description: "Tracking skill" }));
    registry = new SkillRegistry({ skillDirs: [tmpDir] });
    registry.discover();
  });

  afterEach(() => {
    registry.destroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts with matchCount of 0", () => {
    const skill = registry.get("tracker");
    expect(skill!.matchCount).toBe(0);
  });

  it("increments matchCount each time recordMatch is called", () => {
    registry.recordMatch("tracker");
    registry.recordMatch("tracker");
    expect(registry.get("tracker")!.matchCount).toBe(2);
  });

  it("sets lastMatchedAt after recordMatch", () => {
    const before = Date.now();
    registry.recordMatch("tracker");
    const after = Date.now();

    const skill = registry.get("tracker");
    expect(skill!.lastMatchedAt).toBeDefined();
    const ts = new Date(skill!.lastMatchedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("is a no-op for unknown skill names", () => {
    expect(() => registry.recordMatch("does-not-exist")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clear() and destroy()
// ---------------------------------------------------------------------------

describe("SkillRegistry.clear() and destroy()", () => {
  let tmpDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aionima-skills-clear-"));
    writeFileSync(join(tmpDir, "a.skill.md"), makeSkillContent({ name: "a", description: "Skill A" }));
    registry = new SkillRegistry({ skillDirs: [tmpDir] });
    registry.discover();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("clear() removes all skills from the registry", () => {
    expect(registry.count).toBe(1);
    registry.clear();
    expect(registry.count).toBe(0);
    expect(registry.getAll()).toHaveLength(0);
  });

  it("destroy() removes all skills", () => {
    registry.destroy();
    expect(registry.count).toBe(0);
  });

  it("destroy() can be called multiple times without error", () => {
    expect(() => {
      registry.destroy();
      registry.destroy();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Skill matching / loader (loader.ts)
// ---------------------------------------------------------------------------

/** Build a registry with pre-loaded skill content (no file I/O). */
function makeRegistryWithSkills(skills: Array<{
  name: string;
  description: string;
  domain?: string;
  triggers?: string[];
  requiresState?: Array<"ONLINE" | "LIMBO" | "OFFLINE" | "UNKNOWN">;
  requiresTier?: "unverified" | "verified" | "sealed";
  priority?: number;
  directInvoke?: boolean;
  body?: string;
}>): SkillRegistry {
  // Use a temp dir approach: write skill files, discover, then clean up.
  const tmpDir = mkdtempSync(join(tmpdir(), "aionima-skills-registry-"));

  for (const s of skills) {
    const content = makeSkillContent({
      name: s.name,
      description: s.description,
      domain: s.domain,
      triggers: s.triggers,
      requiresState: s.requiresState as string[] | undefined,
      requiresTier: s.requiresTier,
      priority: s.priority,
      directInvoke: s.directInvoke,
      body: s.body,
    });
    writeFileSync(join(tmpDir, `${s.name}.skill.md`), content);
  }

  const populated = new SkillRegistry({ skillDirs: [tmpDir] });
  populated.discover();

  // Cleanup temp dir immediately (data is in memory now)
  rmSync(tmpDir, { recursive: true, force: true });

  return populated;
}

describe("matchSkills — matches triggers against input", () => {
  it("returns a match when input matches a trigger pattern", () => {
    const registry = makeRegistryWithSkills([
      { name: "impact-skill", description: "Impact tracking", triggers: ["\\bimpact\\b"] },
    ]);
    const matches = matchSkills("Tell me about impact measurement", registry, ONLINE_CTX);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.skill.name).toBe("impact-skill");
  });

  it("returns empty array when no trigger matches", () => {
    const registry = makeRegistryWithSkills([
      { name: "impact-skill", description: "Impact tracking", triggers: ["\\bimpact\\b"] },
    ]);
    const matches = matchSkills("something unrelated", registry, ONLINE_CTX);
    expect(matches).toHaveLength(0);
  });

  it("returns one match per skill even when multiple triggers match", () => {
    const registry = makeRegistryWithSkills([
      { name: "multi", description: "Multi trigger", triggers: ["\\bfoo\\b", "\\bbar\\b"] },
    ]);
    // Both "foo" and "bar" appear but should only produce one match entry
    const matches = matchSkills("foo bar", registry, ONLINE_CTX);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.skill.name).toBe("multi");
  });

  it("records which trigger matched", () => {
    const registry = makeRegistryWithSkills([
      { name: "patterned", description: "Has patterns", triggers: ["\\bfoo\\b", "\\bbar\\b"] },
    ]);
    const matches = matchSkills("bar baz", registry, ONLINE_CTX);
    expect(matches[0]!.matchedTrigger).toBe("\\bbar\\b");
  });

  it("is case-insensitive (regex compiled with /i flag)", () => {
    const registry = makeRegistryWithSkills([
      { name: "case-test", description: "Case insensitive", triggers: ["\\bimpact\\b"] },
    ]);
    const matches = matchSkills("IMPACT is important", registry, ONLINE_CTX);
    expect(matches).toHaveLength(1);
  });
});

describe("matchSkills — filters by requiresState", () => {
  it("excludes skills that require ONLINE when state is OFFLINE", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "online-only",
        description: "Only when online",
        triggers: ["\\btest\\b"],
        requiresState: ["ONLINE"],
      },
    ]);
    const matches = matchSkills("test input", registry, OFFLINE_CTX);
    expect(matches).toHaveLength(0);
  });

  it("includes skills that require ONLINE when state is ONLINE", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "online-only",
        description: "Only when online",
        triggers: ["\\btest\\b"],
        requiresState: ["ONLINE"],
      },
    ]);
    const matches = matchSkills("test input", registry, ONLINE_CTX);
    expect(matches).toHaveLength(1);
  });

  it("includes skills with no requiresState restriction regardless of state", () => {
    const registry = makeRegistryWithSkills([
      { name: "unrestricted", description: "Any state", triggers: ["\\btest\\b"] },
    ]);
    const matchesOnline = matchSkills("test", registry, ONLINE_CTX);
    const matchesOffline = matchSkills("test", registry, OFFLINE_CTX);
    expect(matchesOnline).toHaveLength(1);
    expect(matchesOffline).toHaveLength(1);
  });

  it("includes skill when state is in the requiresState list", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "multi-state",
        description: "Online or Limbo",
        triggers: ["\\btest\\b"],
        requiresState: ["ONLINE", "LIMBO"],
      },
    ]);
    const matchesOnline = matchSkills("test", registry, ONLINE_CTX);
    const matchesLimbo = matchSkills("test", registry, { state: "LIMBO", entityTier: "unverified" });
    expect(matchesOnline).toHaveLength(1);
    expect(matchesLimbo).toHaveLength(1);
  });
});

describe("matchSkills — filters by requiresTier", () => {
  it("excludes skills requiring verified tier when entity is unverified", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "verified-skill",
        description: "Verified only",
        triggers: ["\\btest\\b"],
        requiresTier: "verified",
      },
    ]);
    const matches = matchSkills("test", registry, ONLINE_CTX); // unverified
    expect(matches).toHaveLength(0);
  });

  it("includes skills requiring verified tier when entity is verified", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "verified-skill",
        description: "Verified only",
        triggers: ["\\btest\\b"],
        requiresTier: "verified",
      },
    ]);
    const matches = matchSkills("test", registry, VERIFIED_CTX);
    expect(matches).toHaveLength(1);
  });

  it("includes sealed-tier skill only for sealed entities", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "sealed-skill",
        description: "Sealed only",
        triggers: ["\\btest\\b"],
        requiresTier: "sealed",
      },
    ]);
    expect(matchSkills("test", registry, ONLINE_CTX)).toHaveLength(0);
    expect(matchSkills("test", registry, VERIFIED_CTX)).toHaveLength(0);
    expect(matchSkills("test", registry, SEALED_CTX)).toHaveLength(1);
  });
});

describe("matchSkills — sorts by priority descending", () => {
  it("higher priority skills appear first", () => {
    const registry = makeRegistryWithSkills([
      { name: "low", description: "Low priority", triggers: ["\\btest\\b"], priority: 1 },
      { name: "high", description: "High priority", triggers: ["\\btest\\b"], priority: 100 },
      { name: "mid", description: "Mid priority", triggers: ["\\btest\\b"], priority: 50 },
    ]);
    const matches = matchSkills("test", registry, ONLINE_CTX);
    expect(matches).toHaveLength(3);
    expect(matches[0]!.skill.name).toBe("high");
    expect(matches[1]!.skill.name).toBe("mid");
    expect(matches[2]!.skill.name).toBe("low");
  });

  it("returns skills with equal priority without crashing (stable relative order)", () => {
    const registry = makeRegistryWithSkills([
      { name: "alpha", description: "Alpha", triggers: ["\\btest\\b"], priority: 10 },
      { name: "beta", description: "Beta", triggers: ["\\btest\\b"], priority: 10 },
    ]);
    const matches = matchSkills("test", registry, ONLINE_CTX);
    expect(matches).toHaveLength(2);
    // Just verify both are returned, not their relative order
    const names = matches.map((m) => m.skill.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });
});

// ---------------------------------------------------------------------------
// matchByName
// ---------------------------------------------------------------------------

describe("matchByName — returns skill by exact name", () => {
  it("returns the SkillDefinition for a known valid skill", () => {
    const registry = makeRegistryWithSkills([
      { name: "my-skill", description: "My skill", triggers: ["\\bfoo\\b"] },
    ]);
    const def = matchByName("my-skill", registry, ONLINE_CTX);
    expect(def).not.toBeNull();
    expect(def!.name).toBe("my-skill");
  });

  it("returns null for a name that does not exist", () => {
    const registry = makeRegistryWithSkills([
      { name: "my-skill", description: "My skill", triggers: ["\\bfoo\\b"] },
    ]);
    expect(matchByName("does-not-exist", registry, ONLINE_CTX)).toBeNull();
  });

  it("returns null when skill is registered but invalid", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aionima-skills-inv-"));
    writeFileSync(join(tmpDir, "broken.skill.md"), "no frontmatter");
    const registry = new SkillRegistry({ skillDirs: [tmpDir] });
    registry.discover();
    rmSync(tmpDir, { recursive: true, force: true });

    expect(matchByName("broken", registry, ONLINE_CTX)).toBeNull();
  });

  it("returns null when directInvoke is false", () => {
    const registry = makeRegistryWithSkills([
      { name: "no-direct", description: "Cannot be invoked directly", triggers: ["\\bfoo\\b"], directInvoke: false },
    ]);
    expect(matchByName("no-direct", registry, ONLINE_CTX)).toBeNull();
  });

  it("returns null when state filter excludes the skill", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "online-only",
        description: "Only online",
        triggers: ["\\bfoo\\b"],
        requiresState: ["ONLINE"],
      },
    ]);
    expect(matchByName("online-only", registry, OFFLINE_CTX)).toBeNull();
  });

  it("returns null when tier filter excludes the skill", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "sealed-only",
        description: "Only sealed",
        triggers: ["\\bfoo\\b"],
        requiresTier: "sealed",
      },
    ]);
    expect(matchByName("sealed-only", registry, VERIFIED_CTX)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildSkillInjection
// ---------------------------------------------------------------------------

describe("buildSkillInjection — formats prompt block with header", () => {
  it("returns empty injection when matches array is empty", () => {
    const registry = makeRegistryWithSkills([]);
    const result = buildSkillInjection([], registry);
    expect(result.promptBlock).toBe("");
    expect(result.injectedSkills).toHaveLength(0);
    expect(result.estimatedTokens).toBe(0);
  });

  it("returns a promptBlock containing the skill header", () => {
    const registry = makeRegistryWithSkills([
      { name: "imp", description: "Impact skill", triggers: ["\\bimpact\\b"], body: "Use impact scoring." },
    ]);
    const matches = matchSkills("talk about impact", registry, ONLINE_CTX);
    const result = buildSkillInjection(matches, registry);

    expect(result.promptBlock).toContain("## Active Skills");
    expect(result.promptBlock).toContain("imp");
  });

  it("lists injected skill names in injectedSkills", () => {
    const registry = makeRegistryWithSkills([
      { name: "imp", description: "Impact skill", triggers: ["\\btest\\b"] },
    ]);
    const matches = matchSkills("test", registry, ONLINE_CTX);
    const result = buildSkillInjection(matches, registry);

    expect(result.injectedSkills).toContain("imp");
  });

  it("estimates token count as greater than zero for non-empty injection", () => {
    const registry = makeRegistryWithSkills([
      { name: "tok", description: "Token test skill", triggers: ["\\btest\\b"], body: "Some content." },
    ]);
    const matches = matchSkills("test", registry, ONLINE_CTX);
    const result = buildSkillInjection(matches, registry);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it("calls recordMatch for each injected skill", () => {
    const registry = makeRegistryWithSkills([
      { name: "counted", description: "Count me", triggers: ["\\btest\\b"] },
    ]);
    const matches = matchSkills("test", registry, ONLINE_CTX);
    buildSkillInjection(matches, registry);

    expect(registry.get("counted")!.matchCount).toBe(1);
  });
});

describe("buildSkillInjection — respects maxSkillsPerCall", () => {
  it("does not inject more skills than maxSkillsPerCall", () => {
    const registry = makeRegistryWithSkills([
      { name: "a", description: "Skill A", triggers: ["\\btest\\b"], priority: 3 },
      { name: "b", description: "Skill B", triggers: ["\\btest\\b"], priority: 2 },
      { name: "c", description: "Skill C", triggers: ["\\btest\\b"], priority: 1 },
    ]);
    const matches = matchSkills("test", registry, ONLINE_CTX);
    expect(matches).toHaveLength(3);

    const result = buildSkillInjection(matches, registry, { maxSkillsPerCall: 2 });
    expect(result.injectedSkills).toHaveLength(2);
    // Highest priority injected first
    expect(result.injectedSkills[0]).toBe("a");
    expect(result.injectedSkills[1]).toBe("b");
  });
});

describe("buildSkillInjection — respects skillTokenBudget", () => {
  it("stops injecting when token budget is exceeded", () => {
    // Create a skill with substantial body content
    const longBody = "A".repeat(1600); // ~400 tokens on its own
    const registry = makeRegistryWithSkills([
      { name: "big", description: "Big skill", triggers: ["\\btest\\b"], priority: 2, body: longBody },
      { name: "small", description: "Small skill", triggers: ["\\btest\\b"], priority: 1, body: "Short." },
    ]);
    const matches = matchSkills("test", registry, ONLINE_CTX);

    // Very tight budget: only header + first skill should fit
    const result = buildSkillInjection(matches, registry, { skillTokenBudget: 50 });
    // With budget of 50 tokens, even the header alone (~10-15 tokens) plus any skill
    // may exceed; at minimum only 0 or 1 skill injected
    expect(result.injectedSkills.length).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// getAvailableSkills
// ---------------------------------------------------------------------------

describe("getAvailableSkills — filters by state and tier", () => {
  it("returns all valid skills when no restrictions", () => {
    const registry = makeRegistryWithSkills([
      { name: "a", description: "Skill A", triggers: ["\\ba\\b"] },
      { name: "b", description: "Skill B", triggers: ["\\bb\\b"] },
    ]);
    const available = getAvailableSkills(registry, ONLINE_CTX);
    expect(available).toHaveLength(2);
  });

  it("excludes skills whose state requirement does not match", () => {
    const registry = makeRegistryWithSkills([
      { name: "online-req", description: "Online required", triggers: ["\\ba\\b"], requiresState: ["ONLINE"] },
      { name: "any-state", description: "Any state", triggers: ["\\bb\\b"] },
    ]);
    const available = getAvailableSkills(registry, OFFLINE_CTX);
    expect(available).toHaveLength(1);
    expect(available[0]!.name).toBe("any-state");
  });

  it("excludes skills whose tier requirement is not met", () => {
    const registry = makeRegistryWithSkills([
      { name: "sealed-req", description: "Sealed required", triggers: ["\\ba\\b"], requiresTier: "sealed" },
      { name: "open", description: "Open to all", triggers: ["\\bb\\b"] },
    ]);
    const available = getAvailableSkills(registry, VERIFIED_CTX);
    expect(available).toHaveLength(1);
    expect(available[0]!.name).toBe("open");
  });

  it("excludes invalid skills", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aionima-skills-avail-"));
    writeFileSync(join(tmpDir, "valid.skill.md"), makeSkillContent({ name: "valid", description: "Valid" }));
    writeFileSync(join(tmpDir, "invalid.skill.md"), "broken content");
    const registry = new SkillRegistry({ skillDirs: [tmpDir] });
    registry.discover();
    rmSync(tmpDir, { recursive: true, force: true });

    const available = getAvailableSkills(registry, ONLINE_CTX);
    expect(available).toHaveLength(1);
    expect(available[0]!.name).toBe("valid");
  });
});

// ---------------------------------------------------------------------------
// filterByDomain
// ---------------------------------------------------------------------------

describe("filterByDomain — returns only matching domain", () => {
  it("returns skills matching the requested domain", () => {
    const registry = makeRegistryWithSkills([
      { name: "imp-skill", description: "Impact skill", domain: "impact", triggers: ["\\bfoo\\b"] },
      { name: "util-skill", description: "Utility skill", domain: "utility", triggers: ["\\bbar\\b"] },
    ]);
    const all = getAvailableSkills(registry, ONLINE_CTX);
    const impactOnly = filterByDomain(all, "impact");

    expect(impactOnly).toHaveLength(1);
    expect(impactOnly[0]!.name).toBe("imp-skill");
  });

  it("returns empty array when no skills match the domain", () => {
    const registry = makeRegistryWithSkills([
      { name: "util-skill", description: "Utility skill", domain: "utility", triggers: ["\\bfoo\\b"] },
    ]);
    const all = getAvailableSkills(registry, ONLINE_CTX);
    const result = filterByDomain(all, "governance");
    expect(result).toHaveLength(0);
  });

  it("returns all skills when all match the domain", () => {
    const registry = makeRegistryWithSkills([
      { name: "voice-a", description: "Voice skill A", domain: "voice", triggers: ["\\bfoo\\b"] },
      { name: "voice-b", description: "Voice skill B", domain: "voice", triggers: ["\\bbar\\b"] },
    ]);
    const all = getAvailableSkills(registry, ONLINE_CTX);
    const result = filterByDomain(all, "voice");
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. CLI commands (cli.ts)
// ---------------------------------------------------------------------------

describe("listSkills — returns sorted skills with metadata", () => {
  it("returns all skills with their metadata", () => {
    const registry = makeRegistryWithSkills([
      { name: "z-skill", description: "Z skill", domain: "utility", triggers: ["\\bz\\b"], priority: 5 },
      { name: "a-skill", description: "A skill", domain: "impact", triggers: ["\\ba\\b"], priority: 1 },
    ]);
    const output = listSkills(registry);

    expect(output.total).toBe(2);
    expect(output.valid).toBe(2);
    expect(output.invalid).toBe(0);
    expect(output.skills).toHaveLength(2);
  });

  it("sorts skills by domain then name", () => {
    const registry = makeRegistryWithSkills([
      { name: "z-skill", description: "Z skill", domain: "utility", triggers: ["\\bz\\b"] },
      { name: "a-skill", description: "A skill", domain: "impact", triggers: ["\\ba\\b"] },
      { name: "b-skill", description: "B skill", domain: "impact", triggers: ["\\bb\\b"] },
    ]);
    const output = listSkills(registry);
    const names = output.skills.map((s) => s.name);

    // impact comes before utility alphabetically
    expect(names.indexOf("a-skill")).toBeLessThan(names.indexOf("z-skill"));
    expect(names.indexOf("b-skill")).toBeLessThan(names.indexOf("z-skill"));
    // a before b within same domain
    expect(names.indexOf("a-skill")).toBeLessThan(names.indexOf("b-skill"));
  });

  it("includes trigger count, not trigger strings", () => {
    const registry = makeRegistryWithSkills([
      { name: "tri", description: "Triple trigger", triggers: ["\\ba\\b", "\\bb\\b", "\\bc\\b"] },
    ]);
    const output = listSkills(registry);
    expect(output.skills[0]!.triggers).toBe(3);
  });

  it("reports invalid skills in invalid count", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aionima-cli-list-"));
    writeFileSync(join(tmpDir, "good.skill.md"), makeSkillContent({ name: "good", description: "Good" }));
    writeFileSync(join(tmpDir, "bad.skill.md"), "no frontmatter");
    const registry = new SkillRegistry({ skillDirs: [tmpDir] });
    registry.discover();
    rmSync(tmpDir, { recursive: true, force: true });

    const output = listSkills(registry);
    expect(output.valid).toBe(1);
    expect(output.invalid).toBe(1);
    expect(output.total).toBe(2);
  });

  it("includes requiresTier as null when not set", () => {
    const registry = makeRegistryWithSkills([
      { name: "open", description: "Open skill", triggers: ["\\btest\\b"] },
    ]);
    const output = listSkills(registry);
    expect(output.skills[0]!.requiresTier).toBeNull();
  });

  it("includes requiresState as empty array when not set", () => {
    const registry = makeRegistryWithSkills([
      { name: "open", description: "Open skill", triggers: ["\\btest\\b"] },
    ]);
    const output = listSkills(registry);
    expect(output.skills[0]!.requiresState).toEqual([]);
  });
});

describe("validateSkill — valid file returns success", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aionima-cli-validate-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns valid: true for a well-formed skill file", () => {
    const filePath = join(tmpDir, "good.skill.md");
    writeFileSync(filePath, makeSkillContent({ name: "good", description: "Good skill", triggers: ["\\btest\\b"], body: "Some content." }));

    const result = validateSkill(filePath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("includes skill metadata when valid", () => {
    const filePath = join(tmpDir, "meta.skill.md");
    writeFileSync(filePath, makeSkillContent({
      name: "meta",
      description: "Meta skill",
      domain: "impact",
      triggers: ["\\bmeta\\b"],
      body: "Content here.",
    }));

    const result = validateSkill(filePath);
    expect(result.skill).toBeDefined();
    expect(result.skill!.name).toBe("meta");
    expect(result.skill!.domain).toBe("impact");
    expect(result.skill!.description).toBe("Meta skill");
    expect(result.skill!.contentLength).toBeGreaterThan(0);
  });
});

describe("validateSkill — missing file returns error", () => {
  it("returns valid: false with file-not-found error", () => {
    const result = validateSkill("/absolute/nonexistent/path/nope.skill.md");
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("File not found");
  });

  it("errors array contains the missing file path", () => {
    const missingPath = "/no/such/file.skill.md";
    const result = validateSkill(missingPath);
    expect(result.errors[0]).toContain(missingPath);
  });
});

describe("validateSkill — warns on empty triggers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aionima-cli-warn-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds a warning when triggers array is empty", () => {
    const filePath = join(tmpDir, "no-triggers.skill.md");
    writeFileSync(filePath, makeSkillContent({
      name: "no-trig",
      description: "No triggers skill",
      triggers: [],
      body: "Some content.",
    }));

    const result = validateSkill(filePath);
    // valid may be false due to warning being treated as error
    expect(result.errors.length).toBeGreaterThan(0);
    const errorText = result.errors.join(" ");
    expect(errorText).toContain("trigger");
  });

  it("sets valid: false when there are errors/warnings", () => {
    const filePath = join(tmpDir, "no-triggers2.skill.md");
    writeFileSync(filePath, makeSkillContent({
      name: "no-trig2",
      description: "No triggers",
      triggers: [],
      body: "Content.",
    }));

    const result = validateSkill(filePath);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// testSkillMatch
// ---------------------------------------------------------------------------

describe("testSkillMatch — returns matches for test input", () => {
  it("returns matching skills for the given input", () => {
    const registry = makeRegistryWithSkills([
      { name: "impact-sk", description: "Impact", triggers: ["\\bimpact\\b"] },
    ]);
    const output = testSkillMatch("impact analysis", registry, ONLINE_CTX);

    expect(output.input).toBe("impact analysis");
    expect(output.matches).toHaveLength(1);
    expect(output.matches[0]!.name).toBe("impact-sk");
  });

  it("returns empty matches for unmatched input", () => {
    const registry = makeRegistryWithSkills([
      { name: "impact-sk", description: "Impact", triggers: ["\\bimpact\\b"] },
    ]);
    const output = testSkillMatch("something else entirely", registry, ONLINE_CTX);
    expect(output.matches).toHaveLength(0);
  });

  it("output.available reflects total available skills for the context", () => {
    const registry = makeRegistryWithSkills([
      { name: "a", description: "Skill A", triggers: ["\\ba\\b"] },
      { name: "b", description: "Skill B", triggers: ["\\bb\\b"] },
    ]);
    const output = testSkillMatch("zzz no match", registry, ONLINE_CTX);
    expect(output.available).toBe(2);
  });

  it("output.filtered is available minus matched count", () => {
    const registry = makeRegistryWithSkills([
      { name: "alpha", description: "Skill Alpha", triggers: ["\\balpha\\b"] },
      { name: "omega", description: "Skill Omega", triggers: ["\\bomega\\b"] },
    ]);
    // Only "alpha" trigger matches — "omega" does not appear in the input
    const output = testSkillMatch("alpha is here but the other is not", registry, ONLINE_CTX);
    expect(output.matches).toHaveLength(1);
    expect(output.filtered).toBe(output.available - output.matches.length);
  });

  it("includes matchedTrigger, confidence, and priority in each match", () => {
    const registry = makeRegistryWithSkills([
      { name: "pri-test", description: "Priority test", triggers: ["\\btest\\b"], priority: 7 },
    ]);
    const output = testSkillMatch("test it", registry, ONLINE_CTX);
    const m = output.matches[0]!;
    expect(m.matchedTrigger).toBe("\\btest\\b");
    expect(m.confidence).toBe(1.0);
    expect(m.priority).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// formatSkillSummary
// ---------------------------------------------------------------------------

describe("formatSkillSummary — returns formatted string", () => {
  it("includes the skill name", () => {
    const registry = makeRegistryWithSkills([
      { name: "fmt-test", description: "Format test", triggers: ["\\btest\\b"] },
    ]);
    const def = registry.get("fmt-test")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary).toContain("fmt-test");
  });

  it("includes the domain", () => {
    const registry = makeRegistryWithSkills([
      { name: "fmt-dom", description: "Format domain", domain: "impact", triggers: ["\\btest\\b"] },
    ]);
    const def = registry.get("fmt-dom")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary).toContain("impact");
  });

  it("includes the description", () => {
    const registry = makeRegistryWithSkills([
      { name: "fmt-desc", description: "My detailed description", triggers: ["\\btest\\b"] },
    ]);
    const def = registry.get("fmt-desc")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary).toContain("My detailed description");
  });

  it("includes trigger count or none label", () => {
    const registry = makeRegistryWithSkills([
      { name: "fmt-tri", description: "With triggers", triggers: ["\\bfoo\\b", "\\bbar\\b"] },
    ]);
    const def = registry.get("fmt-tri")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary).toContain("\\bfoo\\b");
  });

  it("shows (none) when there are no triggers", () => {
    const registry = makeRegistryWithSkills([
      { name: "fmt-notri", description: "No triggers", triggers: [] },
    ]);
    const def = registry.get("fmt-notri")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary).toContain("(none)");
  });

  it("includes priority", () => {
    const registry = makeRegistryWithSkills([
      { name: "fmt-pri", description: "Priority skill", triggers: ["\\btest\\b"], priority: 42 },
    ]);
    const def = registry.get("fmt-pri")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary).toContain("42");
  });

  it("includes State line when requiresState is set", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "fmt-state",
        description: "State restricted",
        triggers: ["\\btest\\b"],
        requiresState: ["ONLINE"],
      },
    ]);
    const def = registry.get("fmt-state")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary).toContain("ONLINE");
  });

  it("includes Tier line when requiresTier is set", () => {
    const registry = makeRegistryWithSkills([
      {
        name: "fmt-tier",
        description: "Tier restricted",
        triggers: ["\\btest\\b"],
        requiresTier: "verified",
      },
    ]);
    const def = registry.get("fmt-tier")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary).toContain("verified");
  });

  it("includes content length in chars", () => {
    const body = "Hello world content.";
    const registry = makeRegistryWithSkills([
      { name: "fmt-len", description: "Length test", triggers: ["\\btest\\b"], body },
    ]);
    const def = registry.get("fmt-len")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary).toContain("chars");
  });

  it("returns a multi-line string", () => {
    const registry = makeRegistryWithSkills([
      { name: "fmt-multi", description: "Multi line test", triggers: ["\\btest\\b"] },
    ]);
    const def = registry.get("fmt-multi")!.definition;
    const summary = formatSkillSummary(def);
    expect(summary.split("\n").length).toBeGreaterThan(1);
  });
});
