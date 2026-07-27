/**
 * realtalk-stream — decomposes a Composer "stream of consciousness" into the
 * 0REALTALK layers the Chat TUI acts on. Purpose (owner directive): let the
 * user pour layered context and multiple chained/unchained requests into one
 * input, and surface/route the structure.
 *
 * Three layers, per the corpus:
 *  - **Terminals** — `:( … ):` persistent modes (repos/prime/lexicon/
 *    definitions/magic-terminal.md, syntax-triggers.md's `:translate:`). Handled
 *    LOCALLY (mode state), not sent to Aion as literal delimiters.
 *  - **Triggers** — `:word:` and chained `:action:scope:target:`
 *    (repos/prime/docs/triggers.md, core/truth/chained-triggers.md). Passed
 *    THROUGH to Aion, which already executes their semantics server-side; the
 *    TUI only recognizes + highlights them.
 *  - **Switches** — `n>` = next-in-queue (the `>` forward operator,
 *    lexicon/definitions/alignment-operators.md + whitepaper §4). Handled
 *    LOCALLY: segments the stream into an ordered request queue.
 *
 * This module is pure (no React, no I/O) and unit-tested; the TUI renders the
 * tokens (highlight), the terminal stack (mode indicator), and the request
 * queue (n> segmentation) from its output.
 */

export type StreamTokenKind = "terminal-open" | "terminal-close" | "trigger" | "switch" | "text";

export interface StreamToken {
  kind: StreamTokenKind;
  text: string;
  /** Start index in the source string. */
  start: number;
  /** End index (exclusive). */
  end: number;
  /** Human-readable meaning — for the highlight/decode surface. */
  decode: string;
  /** true = sent to Aion verbatim (triggers, text); false = consumed locally (terminals, switches). */
  passthrough: boolean;
}

// A trigger is a lowercase word between colons, optionally chained
// (:action:scope:target:) — never contains parens (those are terminals).
const TRIGGER_RE = /^:[a-z][a-z0-9]*(?::[a-z0-9]+)*:/;
// n> — the next-in-queue switch (forward operator on a queue).
const SWITCH_NEXT = "n>";

/** Known trigger → one-line meaning, drawn from repos/prime/docs/triggers.md. Unknown triggers fall back to a generic decode. */
const TRIGGER_MEANINGS: Readonly<Record<string, string>> = {
  hard: "harden directive (persistent rule)",
  verify: "pause and confirm alignment",
  scope: "clarify boundaries before proceeding",
  block: "log a blocker",
  warn: "flag a concern",
  muse: "capture a thought",
  decide: "log a decision",
  assume: "log an assumption",
  note: "inline annotation",
  sidebar: "capture a tangential thought",
  anchor: "mark a reference point",
  example: "capture an example",
  frame: "snapshot the current context",
  theory: "capture a testable hypothesis",
  fix: "capture a bug/issue",
  refine: "mark for improvement",
  popquiz: "runtime assumption test",
  define: "define a term",
  def: "define new syntax",
  translate: "enter 0REALTALK translation terminal",
  pin: "bookmark this context",
  ref: "reference existing knowledge",
  credit: "record accountability (COA)",
  todo: "capture an action item",
  coa: "check the chain of accountability",
  lore: "embed lore (write-only)",
  secret: "embed hidden knowledge (write-only)",
  cannon: "declare a canonical (LAW) truth",
};

function decodeTrigger(text: string): string {
  // text is like ":muse:" or ":coa:core:truth:"
  const segments = text.slice(1, -1).split(":");
  const head = segments[0] ?? "";
  const base = TRIGGER_MEANINGS[head] ?? `trigger: ${head}`;
  if (segments.length > 1) {
    return `${base} — routed ${segments.join(" → ")}`;
  }
  return base;
}

/**
 * Tokenize a stream into an ordered list of tokens. Linear left-to-right scan;
 * terminal delimiters (`:(`, `):`) and the `n>` switch take priority over the
 * trigger pattern, and any run of unmatched characters becomes a `text` token.
 */
export function tokenizeStream(input: string): StreamToken[] {
  const tokens: StreamToken[] = [];
  let i = 0;
  let textStart = -1;

  const flushText = (end: number): void => {
    if (textStart >= 0 && end > textStart) {
      const text = input.slice(textStart, end);
      tokens.push({ kind: "text", text, start: textStart, end, decode: "", passthrough: true });
    }
    textStart = -1;
  };

  while (i < input.length) {
    const rest = input.slice(i);

    if (rest.startsWith(":(")) {
      flushText(i);
      tokens.push({ kind: "terminal-open", text: ":(", start: i, end: i + 2, decode: "open terminal (enter a mode)", passthrough: false });
      i += 2;
      continue;
    }
    if (rest.startsWith("):")) {
      flushText(i);
      tokens.push({ kind: "terminal-close", text: "):", start: i, end: i + 2, decode: "close terminal (exit the mode)", passthrough: false });
      i += 2;
      continue;
    }
    if (rest.startsWith(SWITCH_NEXT)) {
      flushText(i);
      tokens.push({ kind: "switch", text: SWITCH_NEXT, start: i, end: i + 2, decode: "next in queue", passthrough: false });
      i += 2;
      continue;
    }
    const trig = TRIGGER_RE.exec(rest);
    if (trig) {
      flushText(i);
      const text = trig[0];
      tokens.push({ kind: "trigger", text, start: i, end: i + text.length, decode: decodeTrigger(text), passthrough: true });
      i += text.length;
      continue;
    }

    if (textStart < 0) textStart = i;
    i += 1;
  }
  flushText(input.length);
  return tokens;
}

export interface StreamState {
  /** Depth of currently-open terminals (unmatched `:(`). >0 means "in a mode". */
  terminalDepth: number;
  /** The innermost open terminal's kind/label (first word after `:(`), if any. */
  activeTerminal: string | null;
  /** True if any `):` closed with no matching open (unbalanced) — surfaced as a hint, not an error. */
  unbalancedClose: boolean;
  /** The stream split into ordered request segments at top-level (depth-0) `n>` switches, trimmed, empties dropped. */
  requests: string[];
  /** Recognized trigger texts, in order (for a compact summary). */
  triggers: string[];
}

/**
 * Fold tokens into the state the TUI renders: terminal-mode depth/label, the
 * `n>`-segmented request queue, and the recognized triggers. `source` is the
 * original string (needed to slice request segments and read terminal labels).
 */
export function foldStream(tokens: StreamToken[], source: string): StreamState {
  let terminalDepth = 0;
  let unbalancedClose = false;
  const terminalLabelStack: string[] = [];
  const triggers: string[] = [];
  // Request boundaries: source offsets where a depth-0 `n>` splits segments.
  const boundaries: Array<[number, number]> = []; // [switchStart, switchEnd]

  for (const t of tokens) {
    if (t.kind === "terminal-open") {
      terminalDepth += 1;
      // Label = first word of the text immediately after this open.
      const after = source.slice(t.end);
      const label = /^\s*([^\s():]+)/.exec(after)?.[1] ?? "";
      terminalLabelStack.push(label);
    } else if (t.kind === "terminal-close") {
      if (terminalDepth > 0) {
        terminalDepth -= 1;
        terminalLabelStack.pop();
      } else {
        unbalancedClose = true;
      }
    } else if (t.kind === "trigger") {
      triggers.push(t.text);
    } else if (t.kind === "switch" && terminalDepth === 0) {
      boundaries.push([t.start, t.end]);
    }
  }

  // Split source into request segments at the depth-0 `n>` boundaries.
  const requests: string[] = [];
  let cursor = 0;
  for (const [bStart, bEnd] of boundaries) {
    const seg = source.slice(cursor, bStart).trim();
    if (seg) requests.push(seg);
    cursor = bEnd;
  }
  const tail = source.slice(cursor).trim();
  if (tail) requests.push(tail);

  return {
    terminalDepth,
    activeTerminal: terminalLabelStack.length > 0 ? (terminalLabelStack.at(-1) ?? null) : null,
    unbalancedClose,
    requests,
    triggers,
  };
}

export interface ExtractedTerminals {
  /** The message with balanced terminal expressions removed (whitespace collapsed). */
  prose: string;
  /** The raw terminal expressions (`:( … ):`), top-level only — nested terminals stay inside their outer one. */
  terminals: string[];
}

/**
 * Split a message into prose + the balanced terminal expressions it contains.
 * A terminal is `:( … ):`; only top-level (unnested) pairs are extracted, and
 * an unbalanced `:(` with no close is left in the prose (the user is mid-typing
 * or it isn't a real terminal). Used on submit: prose is what the user "said",
 * terminals go to the unpacker.
 */
export function extractTerminals(source: string): ExtractedTerminals {
  const tokens = tokenizeStream(source);
  const terminals: string[] = [];
  const removeRanges: Array<[number, number]> = [];
  const openStarts: number[] = [];
  for (const t of tokens) {
    if (t.kind === "terminal-open") {
      openStarts.push(t.start);
    } else if (t.kind === "terminal-close") {
      const openStart = openStarts.pop();
      // A balanced pair that closes back to depth 0 is a top-level terminal.
      if (openStart !== undefined && openStarts.length === 0) {
        terminals.push(source.slice(openStart, t.end));
        removeRanges.push([openStart, t.end]);
      }
    }
  }
  let prose = "";
  let cursor = 0;
  for (const [s, e] of removeRanges) {
    prose += source.slice(cursor, s);
    cursor = e;
  }
  prose += source.slice(cursor);
  return { prose: prose.replace(/\s+/g, " ").trim(), terminals };
}
