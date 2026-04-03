/**
 * Prompt Injection Sanitization — Task #233 (OC-19 pattern)
 *
 * Strip Unicode control chars, format chars, bidi overrides, and
 * line/paragraph separators from all runtime strings before embedding
 * in LLM system prompts.
 *
 * sanitizeForPromptLiteral() removes \p{Cc}, \p{Cf}, U+2028, U+2029.
 * Lossy by design — trades edge-case fidelity for prompt integrity.
 *
 * Apply to: workspace paths, entity names, channel metadata,
 * any user-derived string entering system prompt.
 *
 * @see openclaw/src/agents/sanitize-for-prompt.ts (threat model OC-19)
 */

// ---------------------------------------------------------------------------
// Unicode category patterns
// ---------------------------------------------------------------------------

/**
 * Control characters (\p{Cc}): U+0000–U+001F and U+007F–U+009F.
 * EXCEPT tab (U+0009), newline (U+000A), and carriage return (U+000D).
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Format characters (\p{Cf}): invisible formatting characters.
 * Includes: soft hyphen, zero-width chars, bidi overrides, etc.
 */
const FORMAT_CHARS = /[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g;

/**
 * Line separator (U+2028) and Paragraph separator (U+2029).
 * These can break out of string literals in some contexts.
 */
const LINE_PARAGRAPH_SEPARATORS = /[\u2028\u2029]/g;

/**
 * Bidirectional override characters specifically.
 * Extra safety — some are already in FORMAT_CHARS but listed explicitly.
 */
const BIDI_OVERRIDES = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a string for safe embedding in an LLM system prompt.
 *
 * Removes:
 * - Control characters (except tab, newline, CR)
 * - Format characters (zero-width, soft hyphen, bidi marks)
 * - Bidirectional override characters
 * - Line/paragraph separators (U+2028, U+2029)
 *
 * This is intentionally lossy. Edge-case Unicode fidelity is sacrificed
 * for prompt integrity and injection resistance.
 *
 * @param input - Raw string from user/channel/entity.
 * @returns Sanitized string safe for prompt embedding.
 */
export function sanitizeForPromptLiteral(input: string): string {
  return input
    .replace(CONTROL_CHARS, "")
    .replace(FORMAT_CHARS, "")
    .replace(BIDI_OVERRIDES, "")
    .replace(LINE_PARAGRAPH_SEPARATORS, " ");
}

/**
 * Sanitize multiple values in a record (e.g., entity metadata).
 * Non-string values are passed through unchanged.
 */
export function sanitizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[sanitizeForPromptLiteral(key)] =
      typeof value === "string" ? sanitizeForPromptLiteral(value) : value;
  }
  return result;
}

/**
 * Check if a string contains potentially dangerous Unicode.
 * Useful for logging/alerting without modifying the string.
 *
 * Uses fresh regex instances to avoid global flag lastIndex issues.
 */
export function containsDangerousUnicode(input: string): boolean {
  // Must create fresh regexes (or reset lastIndex) because /g flag
  // mutates lastIndex on .test(), causing inconsistent results.
  return (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(input) ||
    /[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/.test(input) ||
    /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(input) ||
    /[\u2028\u2029]/.test(input)
  );
}

/**
 * Sanitize a file path for prompt embedding.
 * Normalizes separators and removes dangerous chars.
 */
export function sanitizePath(input: string): string {
  // Normalize backslashes to forward slashes
  let path = input.replace(/\\/g, "/");
  // Remove Unicode dangers
  path = sanitizeForPromptLiteral(path);
  return path;
}
