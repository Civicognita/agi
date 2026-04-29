/**
 * cage-gate — shared path-gating helper for fs/shell tools.
 *
 * **s130 t515 slice 6c (2026-04-29):** all the fs-touching tools
 * (file_read, file_write, dir_list, grep_search) share the exact same
 * pattern — resolve the input path against workspaceRoot, then reject
 * if it escapes. Slice 6a wired the cage into shell-exec inline; this
 * helper extracts that logic so the 4 fs tools can wrap themselves
 * uniformly without copy-paste.
 *
 * **Contract:**
 *   - When `cageProvider` is set AND returns a non-null Cage: cage is
 *     the stricter primitive — workspaceRoot is NOT separately consulted.
 *     Path is allowed iff `isPathInCage(absPath, cage)`.
 *   - When `cageProvider` returns null OR is undefined: fall back to
 *     `absPath.startsWith(workspaceRoot)` (today's behavior).
 *
 * Returns `null` when the path is allowed; returns an error message
 * string when denied. Callers JSON-stringify the error into their tool
 * response shape.
 */

import { isPathInCage, type Cage } from "../agent-cage.js";

export interface PathGateConfig {
  workspaceRoot: string;
  /** Per-invocation cage provider. See agent-cage.ts for semantics.
   *  Optional — when undefined, only workspaceRoot is checked. */
  cageProvider?: () => Cage | null;
}

/** Check whether a tool may operate on the given absolute path. Returns
 *  null when allowed; an error-message string when denied. */
export function gatePath(config: PathGateConfig, absPath: string): string | null {
  if (config.cageProvider !== undefined) {
    const cage = config.cageProvider();
    if (cage !== null) {
      if (!isPathInCage(absPath, cage)) {
        return "Access denied: path is outside the project cage. The chat session is bound to a project; tools can only operate within that project's subtree (.agi/, k/, repos/, .trash/, project root). To request out-of-cage access, ask the owner.";
      }
      return null; // cage check passed; cage is stricter, skip workspaceRoot.
    }
    // Provider wired but returned null → no projectContext; fall through.
  }
  if (!absPath.startsWith(config.workspaceRoot)) {
    return "Access denied: path escapes workspace boundary";
  }
  return null;
}
