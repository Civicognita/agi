/**
 * notification-lifecycle — render-mode policy for iterative-work
 * notifications (s124 t473).
 *
 * Pure helpers, no React. Imported by `NotificationItem.tsx` for the
 * runtime decision and by `NotificationItem.test.ts` for isolated unit
 * coverage. Lives outside the component file so vitest at the
 * monorepo root can run it without resolving the dashboard's `@/*`
 * alias chain.
 */

/** Full preview window for iterative-work notifications. After this, the
 *  bell-list row collapses to a compact "title + project + age" line so
 *  stale thumbnails don't drown the bell list. The full artifact is
 *  always reachable via click-through (chat-routing per t472) — this is
 *  purely a render-density policy, not a data-retention TTL. */
export const FULL_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

/** Should this notification render in compact mode (collapsed thumbnail
 *  + summary), based on its type + age?
 *
 *  Non-iterative-work types are never compacted (they have no
 *  "full preview" mode to collapse from). Iterative-work notifications
 *  collapse once their age exceeds FULL_PREVIEW_TTL_MS.
 *
 *  `now` is injected for deterministic testing. */
export function isCompactByAge(
  notification: { type: string; createdAt: string },
  now: number = Date.now(),
): boolean {
  if (notification.type !== "iterative-work") return false;
  const ageMs = now - new Date(notification.createdAt).getTime();
  return ageMs > FULL_PREVIEW_TTL_MS;
}
