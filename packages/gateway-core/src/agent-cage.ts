/**
 * agent-cage — derives the path subtree a chat-bound tool invocation
 * is allowed to read/write/execute within.
 *
 * **s130 phase B (t515 slice 5, 2026-04-29):** the keystone security
 * primitive for chat tool caging. When a chat session has project
 * context attached, ITS TOOLS — including bash commands — are CAGED
 * to that project folder. Without this primitive, today's chat with
 * project context can shell-exec anywhere reachable by the gateway
 * process — a security surface that grows with every new project.
 *
 * **What this module does:**
 *   - `deriveCage(context)` — computes the allowed subtree(s) given a
 *     ToolExecutionContext. Returns null when no cage applies (e.g.
 *     no projectContext set; gateway-wide tool access).
 *   - `isPathInCage(path, cage)` — predicate the tool registry calls
 *     to gate fs/shell operations. Resolves path traversals (`..`)
 *     correctly so callers can't escape via relative tricks.
 *   - `requiresEscapePrompt(path, cage)` — when isPathInCage is false
 *     but the cage allows AskUserQuestion-gated escape (Q-6 owner
 *     answer), returns true so the agent-invoker fires an escape
 *     prompt before proceeding.
 *
 * **Cage structure** (from Q-6 owner answer 2026-04-28 + s126 ops-mode
 * pattern):
 *   - **Single-repo project (default):** allowed = [projectPath +
 *     {.agi, k, repos, .trash} subtrees]. Project's own source
 *     directly under projectPath/ is INCLUDED.
 *   - **Ops-mode project (category="ops"):** allowed = single-repo
 *     cage UNION all sibling projects' subtrees (per s126 cross-
 *     project tool access pattern).
 *   - **No project context:** cage = null → gateway-wide access
 *     (today's behavior, preserved for non-project-bound chats).
 *   - **AskUserQuestion gate:** when a path is OUTSIDE the cage,
 *     `requiresEscapePrompt` returns true; the agent-invoker is
 *     responsible for firing the prompt.
 *
 * Slice 6 wires this into the tool registry. This slice ships the
 * pure primitive + tests; it has no I/O and no globals.
 */

import { resolve as resolvePath } from "node:path";

export interface CageContext {
  /** Absolute path of the project this chat session is bound to.
   *  When undefined, no cage applies (gateway-wide access). */
  projectContext?: string;
  /** Project's category — drives ops-mode override. */
  projectCategory?: string;
  /** Sibling project paths (for ops-mode cage widening). Source =
   *  workspace.projects from gateway.json. Defaults to empty array
   *  when not provided; ops-mode without siblings = single-project
   *  cage anyway. */
  siblingProjectPaths?: string[];
}

export interface Cage {
  /** Absolute path prefixes the tool is allowed to access. A path
   *  is in-cage iff its resolved form starts with one of these
   *  prefixes (with a trailing path separator to avoid prefix
   *  collisions like `/foo` matching `/foobar`). */
  allowedPrefixes: string[];
  /** True when the cage was widened by ops-mode override (category
   *  was "ops"). Surfaced for logging + the tool registry to know
   *  whether a path that's not in the single-repo cage but IS in a
   *  sibling's subtree was approved by ops-mode rather than by an
   *  AskUserQuestion gate. */
  opsModeWidened: boolean;
  /** When false, AskUserQuestion-gated escape is not allowed (e.g.
   *  for absolute-cage projects). Defaults to true. Reserved for
   *  future "absolute cage" project types. */
  askUserQuestionEscape: boolean;
}

/** Subdirectories under the project path that constitute the s130
 *  cage. Mirrors PROJECT_FOLDER_LAYOUT but adds the project root
 *  itself (the source code directly under projectPath/, separate
 *  from the .agi/ + k/ + repos/ + .trash/ children). */
const PROJECT_CAGE_DIRS = [
  "",          // project root itself
  ".agi",
  "k",
  "repos",
  ".trash",
] as const;

/**
 * Compute the cage for a given execution context. Returns null when
 * no cage applies — the caller treats that as "today's gateway-wide
 * behavior."
 */
export function deriveCage(context: CageContext): Cage | null {
  if (!context.projectContext) return null;

  const projectPath = resolvePath(context.projectContext);
  const allowed: string[] = [];

  // Always include the project's own subtree(s).
  for (const sub of PROJECT_CAGE_DIRS) {
    allowed.push(sub === "" ? projectPath : resolvePath(projectPath, sub));
  }

  // Ops-mode override: widen to sibling project subtrees per s126.
  const opsModeWidened = context.projectCategory === "ops";
  if (opsModeWidened && context.siblingProjectPaths) {
    for (const sibling of context.siblingProjectPaths) {
      const siblingResolved = resolvePath(sibling);
      // Skip the project itself (already covered by the single-repo cage).
      if (siblingResolved === projectPath) continue;
      for (const sub of PROJECT_CAGE_DIRS) {
        allowed.push(sub === "" ? siblingResolved : resolvePath(siblingResolved, sub));
      }
    }
  }

  return {
    allowedPrefixes: allowed,
    opsModeWidened,
    askUserQuestionEscape: true,
  };
}

/**
 * Test whether a path is inside the cage. Path is resolved (so
 * `..`-traversal can't sneak out) and matched against each allowed
 * prefix with a trailing path separator to prevent prefix-collision
 * false positives (`/home/wishborn/foo` matching `/home/wishborn/f`).
 */
export function isPathInCage(path: string, cage: Cage | null): boolean {
  if (cage === null) return true; // no cage = no restriction
  const resolved = resolvePath(path);
  for (const prefix of cage.allowedPrefixes) {
    // Allow exact match (e.g. the project root itself).
    if (resolved === prefix) return true;
    // Allow children: resolved must start with prefix + path-separator.
    if (resolved.startsWith(prefix + "/")) return true;
  }
  return false;
}

/**
 * When a path is OUTSIDE the cage, should the agent-invoker prompt
 * the owner via AskUserQuestion before allowing the operation? True
 * when the cage permits escape (default); false when the cage is
 * absolute (reserved for future high-security project types).
 *
 * Returns false when the path IS in the cage (no prompt needed).
 */
export function requiresEscapePrompt(path: string, cage: Cage | null): boolean {
  if (cage === null) return false; // no cage = no escape needed
  if (isPathInCage(path, cage)) return false;
  return cage.askUserQuestionEscape;
}
