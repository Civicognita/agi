/**
 * Help-mode config — s137 t532 Phase 1.
 *
 * When a chat session is opened via the dashboard's `?` icon (s137
 * t529), the route's `chatContext` is set to a string of the form
 * `help:<page-context>` (s137 t530). This module exposes:
 *
 *   - `isHelpModeContext(ctx)` — predicate that detects the prefix
 *   - `helpModeContextSlice(ctx)` — extracts the page-context portion
 *   - `HELP_MODE_TOOL_ALLOWLIST` — read-only tool budget per the
 *     prompt fragment at `agi/prompts/help-mode.md`
 *   - `helpModeFiltersTool(toolName)` — filter helper that returns
 *     true when the named tool should be HIDDEN in help mode (i.e.
 *     not in the allowlist or marked mutating)
 *
 * Phase 2 wires these into agent-invoker:
 *   - System-prompt assembly reads `agi/prompts/help-mode.md` when
 *     `isHelpModeContext(session.context)` is true
 *   - Tool filter calls `helpModeFiltersTool(name)` to drop forbidden
 *     tools from the per-turn registry
 *
 * Phase 1 (this slice) ships ONLY the substrate. No agent-invoker
 * change yet — the helpers are unused but tested and ready.
 */

const HELP_MODE_PREFIX = "help:";

/**
 * The read-only tool allowlist for help mode. Any tool NOT in this set
 * is forbidden in help-mode chat sessions. See `agi/prompts/help-mode.md`
 * for the rationale.
 *
 * Conservative starter set: documentation lookup + notes-read + status
 * diagnostic + read-only MCP actions. Owner can extend via gateway.json
 * (Phase 3 follow-on) once the help flow proves stable.
 */
export const HELP_MODE_TOOL_ALLOWLIST: ReadonlySet<string> = Object.freeze(new Set([
  "lookup_knowledge",
  "notes", // gated to action: read | get | search at the action-dispatcher level
  "agi_status",
  "mcp", // gated to action: list-servers | list-tools | list-resources | read-resource | list-prompts
])) as ReadonlySet<string>;

/**
 * Tools that are explicitly forbidden in help mode even if they're not
 * caught by the simple allowlist check (e.g. fine-grained per-action
 * filtering for `notes` and `mcp`). Not used by Phase 1's predicate;
 * exposed for Phase 2's per-action filter.
 */
export const HELP_MODE_TOOL_DENYLIST: ReadonlySet<string> = Object.freeze(new Set([
  "bash",
  "file_write",
  "git_status",
  "git_diff",
  "git_add",
  "git_commit",
  "git_branch",
  "shell_exec",
  "taskmaster_dispatch",
  "worker_dispatch",
  "create_plan",
  "update_user_context",
])) as ReadonlySet<string>;

/** True when the chat-session context string is in help-mode shape. */
export function isHelpModeContext(context: string | null | undefined): boolean {
  if (typeof context !== "string") return false;
  return context.startsWith(HELP_MODE_PREFIX);
}

/**
 * Extract the page-context slice from a help-mode context string.
 * Returns null for non-help-mode contexts.
 *
 * Example: `helpModeContextSlice("help:projects browser")` → `"projects browser"`.
 */
export function helpModeContextSlice(context: string | null | undefined): string | null {
  if (!isHelpModeContext(context)) return null;
  return (context as string).slice(HELP_MODE_PREFIX.length);
}

/**
 * Returns true when the named tool should be HIDDEN/blocked in help
 * mode. Caller is responsible for checking the calling chat session's
 * help-mode-ness first; this function ONLY answers the budget query.
 */
export function helpModeFiltersTool(toolName: string): boolean {
  if (HELP_MODE_TOOL_DENYLIST.has(toolName)) return true;
  return !HELP_MODE_TOOL_ALLOWLIST.has(toolName);
}
