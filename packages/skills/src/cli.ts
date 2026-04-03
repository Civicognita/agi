/**
 * Skill CLI Commands — Task #147
 *
 * aionima skills list    — Show discovered skills with domains and triggers
 * aionima skills validate — Parse and validate a skill file
 * aionima skills test     — Dry-run skill matching against test input
 */

import { existsSync } from "node:fs";

import type { SkillFilterContext, SkillDefinition } from "./types.js";
import { SkillRegistry } from "./discovery.js";
import { parseSkillFile } from "./discovery.js";
import { matchSkills, getAvailableSkills } from "./loader.js";

// ---------------------------------------------------------------------------
// CLI output types
// ---------------------------------------------------------------------------

/** Output of the `skills list` command. */
export interface SkillListOutput {
  skills: Array<{
    name: string;
    domain: string;
    description: string;
    triggers: number;
    requiresState: string[];
    requiresTier: string | null;
    priority: number;
    valid: boolean;
    error?: string;
  }>;
  total: number;
  valid: number;
  invalid: number;
}

/** Output of the `skills validate` command. */
export interface SkillValidateOutput {
  valid: boolean;
  skill?: {
    name: string;
    domain: string;
    description: string;
    triggers: string[];
    requiresState: string[];
    requiresTier: string | null;
    contentLength: number;
  };
  errors: string[];
}

/** Output of the `skills test` command. */
export interface SkillTestOutput {
  input: string;
  matches: Array<{
    name: string;
    domain: string;
    matchedTrigger: string;
    confidence: number;
    priority: number;
  }>;
  available: number;
  filtered: number;
}

// ---------------------------------------------------------------------------
// CLI commands
// ---------------------------------------------------------------------------

/**
 * List all discovered skills with metadata.
 */
export function listSkills(registry: SkillRegistry): SkillListOutput {
  const all = registry.getAll();

  const skills = all.map((r) => ({
    name: r.definition.name,
    domain: r.definition.domain,
    description: r.definition.description,
    triggers: r.definition.triggers.length,
    requiresState: r.definition.requiresState ?? [],
    requiresTier: r.definition.requiresTier ?? null,
    priority: r.definition.priority,
    valid: r.valid,
    error: r.error,
  }));

  // Sort by domain, then name
  skills.sort((a, b) => {
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    return a.name.localeCompare(b.name);
  });

  return {
    skills,
    total: all.length,
    valid: all.filter((r) => r.valid).length,
    invalid: all.filter((r) => !r.valid).length,
  };
}

/**
 * Validate a skill file.
 */
export function validateSkill(filePath: string): SkillValidateOutput {
  const errors: string[] = [];

  if (!existsSync(filePath)) {
    return { valid: false, errors: [`File not found: ${filePath}`] };
  }

  if (!filePath.endsWith(".skill.md")) {
    errors.push("File should have .skill.md extension");
  }

  try {
    const definition = parseSkillFile(filePath);

    // Additional validation
    if (definition.triggers.length === 0) {
      errors.push("No trigger patterns defined — skill will never match automatically");
    }

    if (definition.content.length === 0) {
      errors.push("Skill body is empty — nothing to inject into agent prompt");
    }

    return {
      valid: errors.length === 0,
      skill: {
        name: definition.name,
        domain: definition.domain,
        description: definition.description,
        triggers: definition.triggers,
        requiresState: definition.requiresState ?? [],
        requiresTier: definition.requiresTier ?? null,
        contentLength: definition.content.length,
      },
      errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    return { valid: false, errors };
  }
}

/**
 * Test skill matching against a sample input.
 */
export function testSkillMatch(
  input: string,
  registry: SkillRegistry,
  context: SkillFilterContext,
): SkillTestOutput {
  const available = getAvailableSkills(registry, context);
  const matches = matchSkills(input, registry, context);

  return {
    input,
    matches: matches.map((m) => ({
      name: m.skill.name,
      domain: m.skill.domain,
      matchedTrigger: m.matchedTrigger,
      confidence: m.confidence,
      priority: m.skill.priority,
    })),
    available: available.length,
    filtered: available.length - matches.length,
  };
}

/**
 * Format a SkillDefinition for display (used by validate command).
 */
export function formatSkillSummary(def: SkillDefinition): string {
  const lines = [
    `Name:        ${def.name}`,
    `Domain:      ${def.domain}`,
    `Description: ${def.description}`,
    `Triggers:    ${def.triggers.length > 0 ? def.triggers.join(", ") : "(none)"}`,
    `Priority:    ${String(def.priority)}`,
    `Direct:      ${String(def.directInvoke)}`,
  ];

  if (def.requiresState !== undefined) {
    lines.push(`State:       ${def.requiresState.join(", ")}`);
  }
  if (def.requiresTier !== undefined) {
    lines.push(`Tier:        ${def.requiresTier}`);
  }

  lines.push(`Content:     ${String(def.content.length)} chars`);

  return lines.join("\n");
}
