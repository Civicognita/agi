/**
 * PromptInput — the Chat TUI's multi-line input.
 *
 * Replaces `@particle-academy/fancy-tui`'s `Composer` (bugs i-004/i-005 —
 * dropped cursor state + no caret on empty input) with a minimal owned input
 * built on fancy-tui's exported text-buffer primitives (`createTextBuffer` /
 * `reduceTextBuffer`). The key→action mapping and caret model live in the
 * pure, unit-tested `prompt-input-logic.ts`; this is the thin Ink binding.
 *
 * **It does NOT use Ink's focus system.** This is the sole input in the app, so
 * it has no reason to gate on focus — and gating on focus is actively harmful:
 * Ink blurs the active component on every Escape (ink/App.js: `if (input ===
 * escape) setActiveFocusId(undefined)`), which would leave a focus-gated input
 * permanently dead (the freeze Aion hit pressing Esc). By always accepting
 * input and always showing the caret, no focus loss — Esc, a stray focusable,
 * anything — can freeze it. `useInput` delivers keystrokes globally regardless
 * of focus, so nothing is lost.
 */

import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import {
  createTextBuffer,
  reduceTextBuffer,
  useFancyTui,
  type BufferAction,
  type TextBufferState,
} from "@particle-academy/fancy-tui";
import { mapKeyToPromptAction, promptSegments } from "./prompt-input-logic.js";

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  /** Minimum rendered height (rows). Matches fancy-tui's MultilineInput default. */
  minRows?: number;
}

export function PromptInput({ value, onChange, onSubmit, placeholder = "", minRows = 3 }: PromptInputProps): React.JSX.Element {
  const { capabilities } = useFancyTui();
  const [buffer, setBuffer] = useState<TextBufferState>(() => createTextBuffer(value));

  // Resync when the controlled `value` prop diverges from our buffer — e.g.
  // App clears the draft to "" after a submit. Typing-driven changes already
  // match (we call onChange with the value we reduced to), so this only fires
  // on genuine external edits.
  useEffect(() => {
    if (value !== buffer.value) {
      setBuffer((b) => reduceTextBuffer(b, { type: "set", value }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on `value` only; comparing against buffer.value inside avoids a resync loop.
  }, [value]);

  const applyAction = (action: BufferAction): void => {
    setBuffer((b) => {
      const next = reduceTextBuffer(b, action);
      if (next.value !== b.value) onChange(next.value);
      return next;
    });
  };

  useInput((input, key) => {
    const result = mapKeyToPromptAction(input, key, capabilities.shiftEnter);
    switch (result.kind) {
      case "submit":
        onSubmit(buffer.value);
        return;
      case "newline":
        applyAction({ type: "insert", text: "\n" });
        return;
      case "action":
        applyAction(result.action);
        return;
      default:
        return;
    }
  });

  // Always render as active (the caret always shows) — see the file header.
  const segments = promptSegments(buffer.value, buffer.cursor.offset, true, placeholder);

  return (
    <Box borderStyle="double" paddingX={1} minHeight={minRows}>
      <Text>
        {segments.map((seg, i) => (
          <Text key={i} dimColor={seg.dim}>{seg.text}</Text>
        ))}
      </Text>
    </Box>
  );
}
