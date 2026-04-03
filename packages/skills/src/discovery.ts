/**
 * Skill Auto-Discovery — Task #145
 *
 * Scans configured directories for *.skill.md files.
 * Parses YAML frontmatter + markdown body.
 * Builds skill registry at gateway startup.
 */

import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import { join, basename } from "node:path";

import type {
  SkillDefinition,
  SkillDomain,
  RegisteredSkill,
  SkillsConfig,
} from "./types.js";
import { DEFAULT_SKILLS_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Skill Registry
// ---------------------------------------------------------------------------

export class SkillRegistry {
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly config: SkillsConfig;
  private watchers: Array<ReturnType<typeof watch>> = [];

  constructor(config?: Partial<SkillsConfig>) {
    this.config = { ...DEFAULT_SKILLS_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  /**
   * Scan all configured skill directories and load *.skill.md files.
   * Returns count of loaded skills and any errors.
   */
  discover(): { loaded: number; errors: Array<{ file: string; error: string }> } {
    const errors: Array<{ file: string; error: string }> = [];
    let loaded = 0;

    for (const dir of this.config.skillDirs) {
      if (!existsSync(dir)) continue;

      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".skill.md"));

      for (const file of files) {
        const filePath = join(dir, file);
        try {
          const definition = parseSkillFile(filePath);
          this.skills.set(definition.name, {
            definition,
            valid: true,
            matchCount: 0,
          });
          loaded++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ file: filePath, error: message });
          // Register as invalid skill (skipped with warning, no crash)
          const name = basename(file, ".skill.md");
          this.skills.set(name, {
            definition: {
              name,
              description: "",
              domain: "utility",
              triggers: [],
              compiledTriggers: [],
              priority: 0,
              directInvoke: true,
              content: "",
              filePath,
            },
            valid: false,
            error: message,
            matchCount: 0,
          });
        }
      }
    }

    return { loaded, errors };
  }

  // ---------------------------------------------------------------------------
  // Hot-reload watch
  // ---------------------------------------------------------------------------

  /** Start watching skill directories for changes. */
  startWatching(): void {
    if (!this.config.watchForChanges) return;

    for (const dir of this.config.skillDirs) {
      if (!existsSync(dir)) continue;

      const watcher = watch(dir, (_eventType, filename) => {
        if (filename === null || !filename.endsWith(".skill.md")) return;

        const filePath = join(dir, filename);
        if (existsSync(filePath)) {
          // Reload the skill
          try {
            const definition = parseSkillFile(filePath);
            this.skills.set(definition.name, {
              definition,
              valid: true,
              matchCount: this.skills.get(definition.name)?.matchCount ?? 0,
            });
          } catch {
            // Skip reload on parse error
          }
        } else {
          // File deleted — remove from registry
          const name = basename(filename, ".skill.md");
          this.skills.delete(name);
        }
      });

      this.watchers.push(watcher);
    }
  }

  /** Stop watching for changes. */
  stopWatching(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Get a skill by name. */
  get(name: string): RegisteredSkill | undefined {
    return this.skills.get(name);
  }

  /** Get all valid skills. */
  getAll(): RegisteredSkill[] {
    return [...this.skills.values()];
  }

  /** Get only valid, loadable skills. */
  getValid(): RegisteredSkill[] {
    return [...this.skills.values()].filter((s) => s.valid);
  }

  /** Get skill count. */
  get count(): number {
    return this.skills.size;
  }

  /** Get valid skill count. */
  get validCount(): number {
    return this.getValid().length;
  }

  /** Record a match for a skill. */
  recordMatch(skillName: string): void {
    const skill = this.skills.get(skillName);
    if (skill !== undefined) {
      skill.matchCount++;
      skill.lastMatchedAt = new Date().toISOString();
    }
  }

  /** Clear all skills. */
  clear(): void {
    this.skills.clear();
  }

  /** Destroy registry (stop watching + clear). */
  destroy(): void {
    this.stopWatching();
    this.clear();
  }
}

// ---------------------------------------------------------------------------
// Skill file parser
// ---------------------------------------------------------------------------

/**
 * Parse a *.skill.md file.
 *
 * Format:
 * ```
 * ---
 * name: my-skill
 * description: What this skill does
 * domain: utility
 * triggers:
 *   - "\\bimpact\\b"
 *   - "\\$imp"
 * requires_state: [ONLINE]
 * requires_tier: verified
 * priority: 10
 * direct_invoke: true
 * ---
 * # Skill content in markdown
 * ...
 * ```
 */
export function parseSkillFile(filePath: string): SkillDefinition {
  const raw = readFileSync(filePath, "utf-8");
  return parseSkillContent(raw, filePath);
}

/** Parse skill content from string (for testing). */
export function parseSkillContent(raw: string, filePath: string): SkillDefinition {
  const { frontmatter, body } = extractFrontmatter(raw);

  if (Object.keys(frontmatter).length === 0) {
    throw new Error("Missing YAML frontmatter");
  }

  const name = getString(frontmatter, "name") ?? basename(filePath, ".skill.md");
  const description = getString(frontmatter, "description") ?? "";
  const domain = (getString(frontmatter, "domain") ?? "utility") as SkillDomain;
  const triggers = getStringArray(frontmatter, "triggers") ?? [];
  const requiresState = getStringArray(frontmatter, "requires_state") as
    | Array<"ONLINE" | "LIMBO" | "OFFLINE" | "UNKNOWN">
    | undefined;
  const requiresTier = getString(frontmatter, "requires_tier") as
    | "unverified" | "verified" | "sealed"
    | undefined;
  const priority = getNumber(frontmatter, "priority") ?? 0;
  const directInvoke = getBoolean(frontmatter, "direct_invoke") ?? true;

  // Compile trigger regexes
  const compiledTriggers: RegExp[] = [];
  for (const trigger of triggers) {
    try {
      compiledTriggers.push(new RegExp(trigger, "i"));
    } catch {
      throw new Error(`Invalid trigger regex: ${trigger}`);
    }
  }

  if (description === "") {
    throw new Error("Missing required field: description");
  }

  return {
    name,
    description,
    domain,
    triggers,
    compiledTriggers,
    requiresState,
    requiresTier,
    priority,
    directInvoke,
    content: body.trim(),
    filePath,
  };
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (minimal — no external dependency)
// ---------------------------------------------------------------------------

interface FrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

function extractFrontmatter(raw: string): FrontmatterResult {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (match === null) {
    return { frontmatter: {}, body: raw };
  }

  const yamlBlock = match[1] ?? "";
  const body = match[2] ?? "";
  const frontmatter = parseSimpleYaml(yamlBlock);

  return { frontmatter, body };
}

/**
 * Minimal YAML parser for skill frontmatter.
 * Handles: strings, numbers, booleans, arrays (both inline and multi-line).
 * Does NOT handle nested objects, multi-line strings, or complex YAML.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Check for array item (indented "- value") — \r? handles CRLF line endings
    const arrayItemMatch = /^\s+-\s+(.+?)\r?$/.exec(line);
    if (arrayItemMatch !== null && currentKey !== null && currentArray !== null) {
      currentArray.push(parseYamlValue(arrayItemMatch[1]!.trim()) as string);
      continue;
    }

    // Flush previous array
    if (currentKey !== null && currentArray !== null) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    // Key-value pair
    const kvMatch = /^(\w[\w_]*):\s*(.*)$/.exec(trimmed);
    if (kvMatch !== null) {
      const key = kvMatch[1]!;
      const rawValue = kvMatch[2]!.trim();

      // Inline array: [value1, value2]
      if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
        const inner = rawValue.slice(1, -1);
        result[key] = inner
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map(parseYamlValue);
        continue;
      }

      // Empty value — start of multi-line array
      if (rawValue === "") {
        currentKey = key;
        currentArray = [];
        continue;
      }

      result[key] = parseYamlValue(rawValue);
    }
  }

  // Flush final array
  if (currentKey !== null && currentArray !== null) {
    result[currentKey] = currentArray;
  }

  return result;
}

function parseYamlValue(raw: string): unknown {
  // Strip quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Booleans
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Numbers
  const num = Number(raw);
  if (!Number.isNaN(num) && raw !== "") return num;

  return raw;
}

// ---------------------------------------------------------------------------
// Frontmatter accessors (type-safe)
// ---------------------------------------------------------------------------

function getString(fm: Record<string, unknown>, key: string): string | undefined {
  const val = fm[key];
  return typeof val === "string" ? val : undefined;
}

function getNumber(fm: Record<string, unknown>, key: string): number | undefined {
  const val = fm[key];
  return typeof val === "number" ? val : undefined;
}

function getBoolean(fm: Record<string, unknown>, key: string): boolean | undefined {
  const val = fm[key];
  return typeof val === "boolean" ? val : undefined;
}

function getStringArray(fm: Record<string, unknown>, key: string): string[] | undefined {
  const val = fm[key];
  if (!Array.isArray(val)) return undefined;
  return val.filter((v): v is string => typeof v === "string");
}
