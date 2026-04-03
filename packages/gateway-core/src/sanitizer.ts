/**
 * Input sanitization + prompt injection defense.
 *
 * Applied at step [5] of the invocation pipeline — after entity resolution
 * and COA logging, before any content reaches the system prompt or API call.
 *
 * @see docs/governance/agent-invocation-spec.md §2.2
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SanitizationLimits {
  /** Max input bytes before truncation (default: 32 KB). */
  maxInputBytes: number;
}

export interface SanitizedContent {
  originalLength: number;
  sanitizedLength: number;
  wasTruncated: boolean;
  wasRedacted: boolean;
  content: string;
  /** When the input was a content block array (e.g. with images), the sanitized blocks. */
  contentBlocks?: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
}

/** Result of scanning tool results for injection attempts. */
export interface InjectionScanResult {
  wasModified: boolean;
  content: string;
  removedPatterns: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_LIMITS: SanitizationLimits = {
  maxInputBytes: 32_768, // 32 KB
};

// ---------------------------------------------------------------------------
// PII patterns (simple regex — intentionally conservative)
// ---------------------------------------------------------------------------

const PII_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: "phone", pattern: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  // Negative lookahead excludes git SSH URLs (git@host:path) from email redaction.
  { label: "email", pattern: /\b(?!git@)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
];

// ---------------------------------------------------------------------------
// Prompt injection patterns (applied to tool results)
// ---------------------------------------------------------------------------

const INJECTION_PREFIXES = [
  /^you are\b/i,
  /^system:/i,
  /^\[inst\]/i,
  /^\[\/inst\]/i,
  /^<\|system\|>/i,
  /^<\|im_start\|>system/i,
  /^### instruction/i,
  /^human:/i,
  /^assistant:/i,
];

const INJECTION_KEYS_PATTERN = /^\s*\{[\s\S]*"(?:system|role|instruction)"[\s\S]*\}/;
const XML_INJECTION_PATTERN = /<(?:system|role|instruction)\b[^>]*>/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize raw user input before it reaches the system prompt or API call.
 *
 * Steps:
 * 1. Coerce to string.
 * 2. Strip null bytes and normalize whitespace.
 * 3. Redact PII patterns.
 * 4. Truncate if exceeding maxInputBytes.
 */
export function sanitize(
  raw: unknown,
  limits: Partial<SanitizationLimits> = {},
): SanitizedContent {
  const effectiveLimits: SanitizationLimits = { ...DEFAULT_LIMITS, ...limits };

  // Content block arrays (e.g. text + images) — sanitize text blocks, pass others through.
  if (Array.isArray(raw)) {
    const blocks = raw as Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
    const sanitizedBlocks: typeof blocks = [];
    let combinedText = "";
    let wasRedacted = false;

    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        const textResult = sanitize(block.text, limits);
        sanitizedBlocks.push({ ...block, text: textResult.content });
        combinedText += textResult.content;
        if (textResult.wasRedacted) wasRedacted = true;
      } else {
        // Image and other blocks pass through as-is
        sanitizedBlocks.push(block);
      }
    }

    return {
      originalLength: combinedText.length,
      sanitizedLength: combinedText.length,
      wasTruncated: false,
      wasRedacted,
      content: combinedText,
      contentBlocks: sanitizedBlocks,
    };
  }

  // Coerce to string
  let content = typeof raw === "string" ? raw : String(raw ?? "");
  const originalLength = content.length;

  // Strip null bytes
  content = content.replaceAll("\0", "");

  // Normalize whitespace (collapse runs, trim)
  content = content.replace(/[^\S\n]+/g, " ").trim();

  // Redact PII
  let wasRedacted = false;
  for (const { pattern } of PII_PATTERNS) {
    const before = content;
    content = content.replace(pattern, "[REDACTED]");
    if (content !== before) wasRedacted = true;
  }

  // Truncate
  let wasTruncated = false;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);
  if (bytes.length > effectiveLimits.maxInputBytes) {
    // Find the character boundary that fits within the byte limit
    const decoder = new TextDecoder();
    content = decoder.decode(bytes.slice(0, effectiveLimits.maxInputBytes));
    // Remove any partial multibyte character at the end
    content = content.replace(/[\uFFFD]$/, "");
    wasTruncated = true;
  }

  return {
    originalLength,
    sanitizedLength: content.length,
    wasTruncated,
    wasRedacted,
    content,
  };
}

/**
 * Scan tool results for prompt injection attempts.
 *
 * @see docs/governance/agent-invocation-spec.md §6.3
 */
export function scanToolResult(raw: string): InjectionScanResult {
  let content = raw;
  const removedPatterns: string[] = [];

  // Check for role-reassignment prefixes (line by line)
  const lines = content.split("\n");
  const filtered = lines.map((line) => {
    const trimmed = line.trim();
    for (const prefix of INJECTION_PREFIXES) {
      if (prefix.test(trimmed)) {
        removedPatterns.push(trimmed.slice(0, 60));
        return "[Content removed: security policy]";
      }
    }
    return line;
  });
  content = filtered.join("\n");

  // Check for top-level JSON with system/role/instruction keys
  if (INJECTION_KEYS_PATTERN.test(content)) {
    removedPatterns.push("JSON with system/role/instruction keys");
    content = "[Content removed: security policy]";
  }

  // Check for XML injection tags
  if (XML_INJECTION_PATTERN.test(content)) {
    content = content.replace(XML_INJECTION_PATTERN, "[Content removed: security policy]");
    removedPatterns.push("XML injection tag");
  }

  return {
    wasModified: removedPatterns.length > 0,
    content,
    removedPatterns,
  };
}

/**
 * Enforce size cap on tool results.
 *
 * @param result - Raw tool result string.
 * @param maxBytes - Maximum byte size.
 * @returns Capped result with truncation notice if applicable.
 */
export function capToolResult(result: string, maxBytes: number): { content: string; wasTruncated: boolean } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(result);

  if (bytes.length <= maxBytes) {
    return { content: result, wasTruncated: false };
  }

  const decoder = new TextDecoder();
  let capped = decoder.decode(bytes.slice(0, maxBytes));
  capped = capped.replace(/[\uFFFD]$/, "");
  capped += `\n[Result truncated at ${String(maxBytes)} bytes. Full result available on request.]`;

  return { content: capped, wasTruncated: true };
}
