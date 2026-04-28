export { cn } from "@particle-academy/react-fancy";

/**
 * Belt-and-braces guard for spreading/iterating server responses.
 *
 * Phase 2 DB consolidation (v0.4.41) made many gateway store methods
 * async. A handler that forgets `await` serializes an unresolved Promise
 * as `{}`, and the client then crashes with `TypeError: X is not
 * iterable` when it hits `[...someField]`. v0.4.65/69/71 patched the
 * known offenders server-side, but using this helper at every client
 * spread site means a future regression degrades to an empty list
 * instead of taking the whole page down mid-render.
 *
 * Rule of thumb: if you're about to write `[...x]` or `new Set(x)` or
 * `for (const _ of x)` against a value that came from a fetch, wrap
 * it in `safeArray(x)` first.
 */
export function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
