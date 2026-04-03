// Skills package — NC 2.8 Skills System

export type {
  SkillDefinition,
  SkillDomain,
  RegisteredSkill,
  SkillMatch,
  SkillFilterContext,
  SkillInjection,
  SkillsConfig,
} from "./types.js";
export { DEFAULT_SKILLS_CONFIG } from "./types.js";

export { SkillRegistry, parseSkillFile, parseSkillContent } from "./discovery.js";

export {
  matchSkills,
  matchByName,
  buildSkillInjection,
  getAvailableSkills,
  filterByDomain,
} from "./loader.js";

export {
  listSkills,
  validateSkill,
  testSkillMatch,
  formatSkillSummary,
} from "./cli.js";
export type {
  SkillListOutput,
  SkillValidateOutput,
  SkillTestOutput,
} from "./cli.js";
