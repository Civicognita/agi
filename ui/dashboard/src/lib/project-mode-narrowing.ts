/**
 * Project mode narrowing (s134 t517 item 8 follow-up, 2026-05-10).
 *
 * Centralizes the per-category mode-visibility rule that was previously
 * inlined at two call sites in ProjectDetail.tsx. Keeping it in one
 * place + unit-testable means future category additions (or rule
 * tweaks) don't need to be replicated and don't drift between the
 * auto-redirect useEffect and the mode-picker render.
 *
 * Rule (per s134 t517 slice 4):
 *   - `literature` and `media` projects hide `develop` and `operate` modes.
 *   - `administration` projects hide `develop` mode (operate is still visible).
 *   - All other categories show every mode.
 *
 * The category itself can be sourced from either `project.category`
 * (top-level, set by ops mode) or `project.projectType.category`
 * (declared by the project type registry). Both call sites use the
 * same `cat ?? projectType.category` resolution.
 */

export type ProjectMode = "develop" | "operate" | "coordinate" | "insight";

export const ALL_PROJECT_MODES: readonly ProjectMode[] = [
  "develop",
  "operate",
  "coordinate",
  "insight",
] as const;

/**
 * The four content-category labels that narrow the visible-modes set.
 * Other categories (web, app, etc.) leave all modes visible.
 */
export type NarrowingCategory = "literature" | "media" | "administration";

/**
 * Is the given mode hidden for the project's category? Pure function;
 * mirrored exactly from the inline check in ProjectDetail.tsx.
 *
 *   literature → hide develop + operate
 *   media → hide develop + operate
 *   administration → hide develop
 *   anything else → hide nothing
 */
export function isModeHiddenForCategory(
  mode: ProjectMode,
  category: string | null | undefined,
): boolean {
  if (mode === "develop") {
    return category === "literature" || category === "media" || category === "administration";
  }
  if (mode === "operate") {
    return category === "literature" || category === "media";
  }
  return false;
}

/**
 * Compute the ordered list of modes visible for a category. Always
 * preserves `ALL_PROJECT_MODES` order; just filters out the hidden
 * ones. Returns at least `coordinate` and `insight` for every input
 * (those two are never narrowed).
 */
export function computeVisibleModes(category: string | null | undefined): ProjectMode[] {
  return ALL_PROJECT_MODES.filter((m) => !isModeHiddenForCategory(m, category));
}

/**
 * Pick the first visible mode when the current selection got narrowed
 * out. Returns the next selection or null if `current` is still
 * visible (caller should keep the current mode).
 *
 * Useful for the auto-redirect useEffect that flips selection when the
 * project's category changes.
 */
export function fallbackModeForCategory(
  current: ProjectMode,
  category: string | null | undefined,
): ProjectMode | null {
  if (!isModeHiddenForCategory(current, category)) return null;
  const visible = computeVisibleModes(category);
  return visible[0] ?? "coordinate";
}
