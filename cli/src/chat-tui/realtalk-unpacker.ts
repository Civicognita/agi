/**
 * realtalk-unpacker — the (first-pass) 0REALTALK UNPACKER.
 *
 * A 0REALTALK terminal (`:( … ):`) the user posts is not sent to Aion
 * verbatim: its inner expression is UNPACKED — expanded/executed — and the
 * *output* of that is what reaches the agent (owner directive 2026-07-22).
 * This is deliberately a STUB, not the full de/compiler the corpus envisions
 * (0READER/0WRITER + PACK/UNPACK levels; see repos/prime/evolution/musings/
 * 0realtalk-engine.md) — that lands later. For now it does the one honest
 * thing it can: decode the inner expression via the lexicon reader when it
 * recognizes it, and otherwise pass the content through under an explicit
 * "unpacked" label. Keeping it behind this seam means swapping in the real
 * unpacker later is a one-file change.
 */

import { parseRealtalk } from "./realtalk-reader.js";

export interface UnpackedTerminal {
  /** The full terminal as typed, e.g. `:(TEST(0R 00 0RAW)):`. */
  raw: string;
  /** The inner expression, delimiters stripped, e.g. `TEST(0R 00 0RAW)`. */
  content: string;
  /** The unpacker's output — decoded when recognized, else the content verbatim. */
  output: string;
  /** True when the reader recognized the inner expression (vs. pass-through). */
  recognized: boolean;
}

/** Strip a terminal's `:(` / `):` delimiters, returning the trimmed inner content. */
export function terminalContent(raw: string): string {
  return raw.replace(/^:\(/, "").replace(/\):$/, "").trim();
}

/**
 * Unpack a single terminal. First-pass behavior: if the inner expression is a
 * recognized 0REALTALK pattern (accessor / confidence / impact-mark / term …)
 * the output is its decoded meaning; otherwise the content passes through
 * unchanged. Never throws — an unparseable terminal degrades to pass-through.
 */
export function unpackTerminal(raw: string): UnpackedTerminal {
  const content = terminalContent(raw);
  const decoded = content.length > 0 ? parseRealtalk(content) : null;
  return {
    raw,
    content,
    output: decoded !== null ? decoded.summary : content,
    recognized: decoded !== null,
  };
}

/**
 * Build the text actually sent to Aion for a message: the user's prose plus,
 * for each unpacked terminal, a clearly-labeled output block (so the agent can
 * tell prose from unpacked-0REALTALK). No terminals → prose unchanged.
 */
export function buildWireMessage(prose: string, unpacked: UnpackedTerminal[]): string {
  if (unpacked.length === 0) return prose;
  const blocks = unpacked.map((u) => `⟦0REALTALK unpacked⟧ ${u.output}`).join("\n");
  return prose.length > 0 ? `${prose}\n\n${blocks}` : blocks;
}
