/**
 * Skill Loader — Task #146
 *
 * Matches conversation input to relevant skills via trigger patterns.
 * Injects matched skill content into agent system prompt.
 * Permission checking: skill may require specific entity tier.
 * Skill execution tracking for COA.
 */

import type { GatewayState } from "@aionima/gateway-core";
import type { VerificationTier } from "@aionima/entity-model";

import type {
  SkillDefinition,
  SkillMatch,
  SkillFilterContext,
  SkillInjection,
  SkillsConfig,
} from "./types.js";
import { DEFAULT_SKILLS_CONFIG } from "./types.js";
import type { SkillRegistry } from "./discovery.js";

// ---------------------------------------------------------------------------
// Tier ordering for permission checks
// ---------------------------------------------------------------------------

const TIER_RANK: Record<VerificationTier, number> = {
  unverified: 0,
  verified: 1,
  sealed: 2,
};

// ---------------------------------------------------------------------------
// Skill matching
// ---------------------------------------------------------------------------

/**
 * Match user input against all registered skills.
 *
 * @param input - The user's message text.
 * @param registry - Skill registry to search.
 * @param context - Current state/tier for filtering.
 * @returns Ordered list of matched skills.
 */
export function matchSkills(
  input: string,
  registry: SkillRegistry,
  context: SkillFilterContext,
): SkillMatch[] {
  const matches: SkillMatch[] = [];

  for (const registered of registry.getValid()) {
    const def = registered.definition;

    // Filter by gateway state
    if (def.requiresState !== undefined && def.requiresState.length > 0) {
      if (!def.requiresState.includes(context.state)) continue;
    }

    // Filter by entity tier
    if (def.requiresTier !== undefined) {
      if (TIER_RANK[context.entityTier] < TIER_RANK[def.requiresTier]) continue;
    }

    // Check trigger patterns
    for (let i = 0; i < def.compiledTriggers.length; i++) {
      const regex = def.compiledTriggers[i]!;
      if (regex.test(input)) {
        matches.push({
          skill: def,
          matchedTrigger: def.triggers[i] ?? "",
          confidence: 1.0,
        });
        break; // One match per skill is enough
      }
    }
  }

  // Sort by priority descending, then by confidence
  matches.sort((a, b) => {
    if (a.skill.priority !== b.skill.priority) {
      return b.skill.priority - a.skill.priority;
    }
    return b.confidence - a.confidence;
  });

  return matches;
}

/**
 * Match a skill by exact name (direct invocation).
 */
export function matchByName(
  name: string,
  registry: SkillRegistry,
  context: SkillFilterContext,
): SkillDefinition | null {
  const registered = registry.get(name);
  if (registered === undefined || !registered.valid) return null;

  const def = registered.definition;
  if (!def.directInvoke) return null;

  // Check state filter
  if (def.requiresState !== undefined && def.requiresState.length > 0) {
    if (!def.requiresState.includes(context.state)) return null;
  }

  // Check tier filter
  if (def.requiresTier !== undefined) {
    if (TIER_RANK[context.entityTier] < TIER_RANK[def.requiresTier]) return null;
  }

  return def;
}

// ---------------------------------------------------------------------------
// Skill injection into system prompt
// ---------------------------------------------------------------------------

/**
 * Build a skill injection block for the agent system prompt.
 *
 * @param matches - Matched skills from matchSkills().
 * @param registry - Registry for recording match counts.
 * @param config - Skills configuration for limits.
 * @returns Formatted injection for system prompt.
 */
export function buildSkillInjection(
  matches: SkillMatch[],
  registry: SkillRegistry,
  config?: Partial<SkillsConfig>,
): SkillInjection {
  const cfg = { ...DEFAULT_SKILLS_CONFIG, ...config };

  if (matches.length === 0) {
    return { promptBlock: "", injectedSkills: [], estimatedTokens: 0 };
  }

  const selected: SkillDefinition[] = [];
  let totalTokens = 0;
  const headerTokens = estimateTokens(SKILL_HEADER);

  for (const match of matches) {
    if (selected.length >= cfg.maxSkillsPerCall) break;

    const blockTokens = estimateTokens(formatSkillBlock(match.skill));
    if (totalTokens + blockTokens + headerTokens > cfg.skillTokenBudget) break;

    selected.push(match.skill);
    totalTokens += blockTokens;

    // Record match
    registry.recordMatch(match.skill.name);
  }

  if (selected.length === 0) {
    return { promptBlock: "", injectedSkills: [], estimatedTokens: 0 };
  }

  const blocks = selected.map(formatSkillBlock);
  const promptBlock = `${SKILL_HEADER}\n\n${blocks.join("\n\n---\n\n")}`;

  return {
    promptBlock,
    injectedSkills: selected.map((s) => s.name),
    estimatedTokens: totalTokens + headerTokens,
  };
}

// ---------------------------------------------------------------------------
// Filtering helpers
// ---------------------------------------------------------------------------

/**
 * Get all skills available for an entity given current state/tier.
 */
export function getAvailableSkills(
  registry: SkillRegistry,
  context: SkillFilterContext,
): SkillDefinition[] {
  return registry.getValid()
    .map((r) => r.definition)
    .filter((def) => {
      if (def.requiresState !== undefined && def.requiresState.length > 0) {
        if (!def.requiresState.includes(context.state)) return false;
      }
      if (def.requiresTier !== undefined) {
        if (TIER_RANK[context.entityTier] < TIER_RANK[def.requiresTier]) return false;
      }
      return true;
    });
}

/**
 * Filter skills by domain.
 */
export function filterByDomain(
  skills: SkillDefinition[],
  domain: string,
): SkillDefinition[] {
  return skills.filter((s) => s.domain === domain);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_HEADER = `## Active Skills
The following skills are loaded based on conversation context:`;

function formatSkillBlock(skill: SkillDefinition): string {
  return `### ${skill.name} (${skill.domain})
${skill.description}

${skill.content}`;
}

/** Rough token estimation (4 chars ~ 1 token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Re-export types used by consumers
export type { SkillFilterContext, GatewayState, VerificationTier };
