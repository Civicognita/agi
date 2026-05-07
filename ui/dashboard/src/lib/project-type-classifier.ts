/**
 * Dashboard-side mirror of `DESKTOP_SERVED_TYPES` / `CODE_SERVED_TYPES` /
 * `servesDesktopFor` from gateway-core's project-types.ts.
 *
 * Why duplicate: the dashboard runs in the browser and can't import directly
 * from gateway-core. The lists are small, change rarely (when a new built-in
 * project type is added on either side of the binary), and are explicitly
 * cross-checked by the s150 t636 component-contract tests.
 *
 * Keep this in sync with `agi/packages/gateway-core/src/project-types.ts`.
 */

/** Project type IDs whose network face is served by the Aion Desktop bundle. */
export const DESKTOP_SERVED_TYPES: ReadonlySet<string> = new Set([
  "ops",
  "media",
  "literature",
  "documentation",
  "backup-aggregator",
]);

/** Project type IDs whose network face is produced by the project's own code. */
export const CODE_SERVED_TYPES: ReadonlySet<string> = new Set([
  "web-app",
  "static-site",
  "api-service",
  "php-app",
  "monorepo",
  "art",
  "writing",
]);

/**
 * Returns whether a project type is Desktop-served (true) vs code-served
 * (false). Defaults to false for unknown / unset / empty types — code-served
 * has more conditional UI fields, and a stranger surface is the safer
 * default to render than the Desktop-served one.
 */
export function isDesktopServedType(typeId: string | null | undefined): boolean {
  if (!typeId) return false;
  if (DESKTOP_SERVED_TYPES.has(typeId)) return true;
  return false;
}
