/**
 * Skills system types — Task #145
 *
 * Auto-discovery of *.skill.md files with YAML frontmatter.
 * Skills filtered by requires_state and requires_tier.
 */

import type { GatewayState } from "@agi/gateway-core";
import type { VerificationTier } from "@agi/entity-model";

// ---------------------------------------------------------------------------
// Skill frontmatter (parsed from YAML)
// ---------------------------------------------------------------------------

/** Parsed skill definition from *.skill.md frontmatter. */
export interface SkillDefinition {
  /** Unique skill name (from frontmatter or filename). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Skill domain (verification, memory, impact, identity, utility, learning). */
  domain: SkillDomain;
  /** Trigger patterns — regex strings matched against user input. */
  triggers: string[];
  /** Compiled trigger regexes (built at load time). */
  compiledTriggers: RegExp[];
  /** Required gateway state to activate (default: any). */
  requiresState?: GatewayState[];
  /** Required entity verification tier (default: none). */
  requiresTier?: VerificationTier;
  /** Skill priority — higher priority skills are injected first (default: 0). */
  priority: number;
  /** Whether this skill can be invoked directly by name (default: true). */
  directInvoke: boolean;
  /** The skill's markdown content (body after frontmatter). */
  content: string;
  /** Absolute file path to the skill file. */
  filePath: string;
}

/** Skill domains. */
export type SkillDomain =
  | "verification"
  | "memory"
  | "impact"
  | "identity"
  | "utility"
  | "learning"
  | "governance"
  | "voice"
  | "channel";

// ---------------------------------------------------------------------------
// Skill registry
// ---------------------------------------------------------------------------

/** A loaded skill in the registry with status info. */
export interface RegisteredSkill {
  definition: SkillDefinition;
  /** Whether the skill loaded successfully. */
  valid: boolean;
  /** Load error message (if invalid). */
  error?: string;
  /** Number of times this skill has been matched. */
  matchCount: number;
  /** Last matched timestamp. */
  lastMatchedAt?: string;
}

// ---------------------------------------------------------------------------
// Skill matching
// ---------------------------------------------------------------------------

/** Result of matching user input against skill triggers. */
export interface SkillMatch {
  skill: SkillDefinition;
  /** Which trigger pattern matched. */
  matchedTrigger: string;
  /** Match confidence (0.0-1.0). */
  confidence: number;
}

/** Context for skill filtering. */
export interface SkillFilterContext {
  /** Current gateway state. */
  state: GatewayState;
  /** Entity's verification tier. */
  entityTier: VerificationTier;
}

// ---------------------------------------------------------------------------
// Skill injection result
// ---------------------------------------------------------------------------

/** Result of injecting matched skills into agent context. */
export interface SkillInjection {
  /** Formatted skill block for system prompt. */
  promptBlock: string;
  /** Skills that were injected. */
  injectedSkills: string[];
  /** Estimated token count. */
  estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Skills system configuration. */
export interface SkillsConfig {
  /** Directories to scan for *.skill.md files. */
  skillDirs: string[];
  /** Maximum skills to inject per agent call (default: 5). */
  maxSkillsPerCall: number;
  /** Maximum token budget for skill injection (default: 4000). */
  skillTokenBudget: number;
  /** Watch for file changes and hot-reload (default: false). */
  watchForChanges: boolean;
}

export const DEFAULT_SKILLS_CONFIG: SkillsConfig = {
  skillDirs: [],
  maxSkillsPerCall: 5,
  skillTokenBudget: 4000,
  watchForChanges: false,
};
