/**
 * FileEditor — CodeMirror 6 wrapper with Catppuccin themes and language auto-detection.
 *
 * Uses imperative API (useRef + useEffect) for minimal bundle overhead.
 * Language and theme are configured via Compartments so they can be reconfigured
 * without destroying the editor (preserves undo history).
 */

import { useEffect, useRef } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, drawSelection, highlightActiveLine, highlightSpecialChars } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { foldGutter, foldKeymap, indentOnInput, bracketMatching, syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { StreamLanguage } from "@codemirror/language";
import { yaml as yamlMode } from "@codemirror/legacy-modes/mode/yaml";
import { tags } from "@lezer/highlight";

// ---------------------------------------------------------------------------
// Catppuccin themes — hardcoded hex values because CSS vars aren't reliably
// available at EditorView.theme() evaluation time.
// ---------------------------------------------------------------------------

// Mocha (dark)
const mochaColors = {
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay0: "#6c7086",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  subtext1: "#bac2de",
  blue: "#89b4fa",
  green: "#a6e3a1",
  red: "#f38ba8",
  peach: "#fab387",
  mauve: "#cba6f7",
  yellow: "#f9e2af",
  teal: "#94e2d5",
  sky: "#89dcfe",
  lavender: "#b4befe",
  flamingo: "#f2cdcd",
  rosewater: "#f5e0dc",
};

const darkTheme = EditorView.theme({
  "&": {
    backgroundColor: mochaColors.base,
    color: mochaColors.text,
    height: "100%",
  },
  ".cm-content": {
    caretColor: mochaColors.rosewater,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: "13px",
    lineHeight: "1.6",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: mochaColors.rosewater },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: mochaColors.surface2 + "80",
  },
  ".cm-panels": { backgroundColor: mochaColors.mantle, color: mochaColors.text },
  ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${mochaColors.surface0}` },
  ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${mochaColors.surface0}` },
  ".cm-searchMatch": { backgroundColor: mochaColors.surface2, outline: `1px solid ${mochaColors.overlay0}` },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: mochaColors.surface1 },
  ".cm-activeLine": { backgroundColor: mochaColors.surface0 + "40" },
  ".cm-selectionMatch": { backgroundColor: mochaColors.surface2 + "60" },
  ".cm-matchingBracket, .cm-nonmatchingBracket": { backgroundColor: mochaColors.surface1, outline: `1px solid ${mochaColors.overlay0}` },
  ".cm-gutters": {
    backgroundColor: mochaColors.mantle,
    color: mochaColors.overlay0,
    border: "none",
  },
  ".cm-activeLineGutter": { backgroundColor: mochaColors.surface0 + "40" },
  ".cm-foldPlaceholder": {
    backgroundColor: mochaColors.surface0,
    color: mochaColors.subtext0,
    border: "none",
  },
  ".cm-tooltip": { backgroundColor: mochaColors.surface0, color: mochaColors.text, border: `1px solid ${mochaColors.surface1}` },
  ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: mochaColors.surface0, borderBottomColor: mochaColors.surface0 },
  ".cm-tooltip-autocomplete": { "& > ul > li[aria-selected]": { backgroundColor: mochaColors.surface1 } },
}, { dark: true });

const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: mochaColors.mauve },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: mochaColors.red },
  { tag: [tags.function(tags.variableName)], color: mochaColors.blue },
  { tag: [tags.labelName], color: mochaColors.mauve },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: mochaColors.peach },
  { tag: [tags.definition(tags.name), tags.separator], color: mochaColors.text },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: mochaColors.yellow },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: mochaColors.sky },
  { tag: [tags.meta, tags.comment], color: mochaColors.overlay0 },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: mochaColors.blue, textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: mochaColors.red },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: mochaColors.peach },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: mochaColors.green },
  { tag: tags.invalid, color: mochaColors.red },
]);

// Latte (light)
const latteColors = {
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
  surface0: "#ccd0da",
  surface1: "#bcc0cc",
  surface2: "#acb0be",
  overlay0: "#9ca0b0",
  text: "#4c4f69",
  subtext0: "#6c6f85",
  subtext1: "#5c5f77",
  blue: "#1e66f5",
  green: "#40a02b",
  red: "#d20f39",
  peach: "#fe640b",
  mauve: "#8839ef",
  yellow: "#df8e1d",
  teal: "#179299",
  sky: "#04a5e5",
  lavender: "#7287fd",
  flamingo: "#dd7878",
  rosewater: "#dc8a78",
};

const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: latteColors.base,
    color: latteColors.text,
    height: "100%",
  },
  ".cm-content": {
    caretColor: latteColors.rosewater,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: "13px",
    lineHeight: "1.6",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: latteColors.rosewater },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: latteColors.surface2 + "80",
  },
  ".cm-panels": { backgroundColor: latteColors.mantle, color: latteColors.text },
  ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${latteColors.surface0}` },
  ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${latteColors.surface0}` },
  ".cm-searchMatch": { backgroundColor: latteColors.surface1, outline: `1px solid ${latteColors.overlay0}` },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: latteColors.surface0 },
  ".cm-activeLine": { backgroundColor: latteColors.surface0 + "40" },
  ".cm-selectionMatch": { backgroundColor: latteColors.surface1 + "60" },
  ".cm-matchingBracket, .cm-nonmatchingBracket": { backgroundColor: latteColors.surface0, outline: `1px solid ${latteColors.overlay0}` },
  ".cm-gutters": {
    backgroundColor: latteColors.mantle,
    color: latteColors.overlay0,
    border: "none",
  },
  ".cm-activeLineGutter": { backgroundColor: latteColors.surface0 + "40" },
  ".cm-foldPlaceholder": {
    backgroundColor: latteColors.surface0,
    color: latteColors.subtext0,
    border: "none",
  },
  ".cm-tooltip": { backgroundColor: latteColors.surface0, color: latteColors.text, border: `1px solid ${latteColors.surface1}` },
  ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: latteColors.surface0, borderBottomColor: latteColors.surface0 },
  ".cm-tooltip-autocomplete": { "& > ul > li[aria-selected]": { backgroundColor: latteColors.surface1 } },
}, { dark: false });

const lightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: latteColors.mauve },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: latteColors.red },
  { tag: [tags.function(tags.variableName)], color: latteColors.blue },
  { tag: [tags.labelName], color: latteColors.mauve },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: latteColors.peach },
  { tag: [tags.definition(tags.name), tags.separator], color: latteColors.text },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: latteColors.yellow },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: latteColors.sky },
  { tag: [tags.meta, tags.comment], color: latteColors.overlay0 },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: latteColors.blue, textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: latteColors.red },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: latteColors.peach },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: latteColors.green },
  { tag: tags.invalid, color: latteColors.red },
]);

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

function getLanguageExtension(filePath: string): Extension {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
      return markdown();
    case "json":
      return json();
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: ext === "tsx" });
    case "js":
    case "jsx":
      return javascript({ jsx: ext === "jsx" });
    case "yaml":
    case "yml":
      return StreamLanguage.define(yamlMode);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface FileEditorProps {
  filePath: string;
  content: string;
  theme: "light" | "dark";
  onChange?: (content: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  height?: string;
}

export function FileEditor({
  filePath,
  content,
  theme,
  onChange,
  onSave,
  readOnly = false,
  height = "100%",
}: FileEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  // Keep callback refs fresh
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const themeExtensions = theme === "dark"
      ? [darkTheme, syntaxHighlighting(darkHighlight)]
      : [lightTheme, syntaxHighlighting(lightHighlight)];

    const saveKeymap = keymap.of([{
      key: "Mod-s",
      run: () => {
        onSaveRef.current?.();
        return true;
      },
    }]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        keymap.of([
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        languageCompartment.current.of(getLanguageExtension(filePath)),
        themeCompartment.current.of(themeExtensions),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        saveKeymap,
        updateListener,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only run on mount/unmount — content/theme/filePath changes handled by subsequent effects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconfigure theme when it changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const themeExtensions = theme === "dark"
      ? [darkTheme, syntaxHighlighting(darkHighlight)]
      : [lightTheme, syntaxHighlighting(lightHighlight)];

    view.dispatch({
      effects: themeCompartment.current.reconfigure(themeExtensions),
    });
  }, [theme]);

  // Reconfigure language when filePath changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: languageCompartment.current.reconfigure(getLanguageExtension(filePath)),
    });
  }, [filePath]);

  // Replace content when it changes externally (file switch)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
  }, [content]);

  // Update readOnly
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return (
    <div
      ref={containerRef}
      style={{ height, overflow: "hidden" }}
    />
  );
}
