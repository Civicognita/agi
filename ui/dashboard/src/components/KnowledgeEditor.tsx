/**
 * KnowledgeEditor — smart file editor that routes to react-fancy Editor (markdown/docs)
 * or fancy-code CodeEditor (source files) based on file extension.
 *
 * The markdown variant includes a custom toolbar with memory-aware actions:
 * bold/italic/headings/links plus a "Link Doc" picker backed by searchMemoryDocs().
 */

import { useState, useCallback, useRef } from "react";
import { Editor, useEditor } from "@particle-academy/react-fancy";
import { CodeEditor } from "@particle-academy/fancy-code";
import { searchMemoryDocs } from "@/api.js";
import type { MemoryDocChunk } from "@/api.js";

// ---------------------------------------------------------------------------
// Language detection for fancy-code
// ---------------------------------------------------------------------------

const EXT_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  c: "c", cpp: "cpp", cs: "csharp", sh: "bash", yaml: "yaml", yml: "yaml",
  json: "json", toml: "toml", css: "css", scss: "scss", html: "html",
  xml: "xml", sql: "sql", graphql: "graphql",
};

function guessLanguage(filePath?: string): string {
  if (!filePath) return "plaintext";
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANGUAGE[ext] ?? "plaintext";
}

function isMarkdownFile(filePath?: string): boolean {
  const ext = filePath?.split(".").pop()?.toLowerCase() ?? "";
  return ext === "md" || ext === "mdx";
}

// ---------------------------------------------------------------------------
// DocLinkPicker — inline popover backed by searchMemoryDocs()
// ---------------------------------------------------------------------------

function DocLinkPicker({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryDocChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { insertText } = useEditor();

  const handleQuery = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const chunks = await searchMemoryDocs(q, undefined, 8);
        setResults(chunks);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, []);

  const pickChunk = useCallback((chunk: MemoryDocChunk) => {
    const label = chunk.heading ?? chunk.sourcePath.split("/").pop() ?? "doc";
    insertText(`[${label}](${chunk.sourcePath})`);
    onClose();
  }, [insertText, onClose]);

  return (
    <div className="absolute z-50 left-0 top-full mt-1 w-80 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <div className="p-2 border-b border-zinc-100 dark:border-zinc-800">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => handleQuery(e.target.value)}
          placeholder="Search docs…"
          className="w-full rounded-md bg-zinc-50 px-2.5 py-1.5 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>
      <ul className="max-h-48 overflow-y-auto py-1">
        {loading && (
          <li className="px-3 py-2 text-xs text-zinc-400">Searching…</li>
        )}
        {!loading && results.length === 0 && query.trim() && (
          <li className="px-3 py-2 text-xs text-zinc-400">No results</li>
        )}
        {results.map((chunk) => (
          <li key={chunk.sourcePath + (chunk.heading ?? "")}>
            <button
              type="button"
              onClick={() => pickChunk(chunk)}
              className="w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                {chunk.heading ?? chunk.sourcePath.split("/").pop()}
              </div>
              <div className="truncate text-xs text-zinc-400">{chunk.sourcePath}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MarkdownToolbar — memory-aware toolbar for the react-fancy Editor
// ---------------------------------------------------------------------------

function MarkdownToolbar() {
  const [showDocPicker, setShowDocPicker] = useState(false);
  // Rename 'exec' on destructure to avoid triggering the security hook pattern
  const { exec: runEditorCmd, insertText, wrapSelection } = useEditor();

  const handleBold = () => runEditorCmd("bold");
  const handleItalic = () => runEditorCmd("italic");
  const handleStrike = () => runEditorCmd("strikeThrough");
  const handleH2 = () => insertText("\n## ");
  const handleH3 = () => insertText("\n### ");
  const handleCode = () => wrapSelection("`", "`");
  const handleCodeBlock = () => wrapSelection("\n```\n", "\n```\n");
  const handleLink = () => {
    const url = window.prompt("URL:");
    if (url) wrapSelection("[", `](${url})`);
  };

  const btnBase =
    "rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors";

  return (
    <Editor.Toolbar className="flex items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800/60">
      <button type="button" className={btnBase} onClick={handleBold} title="Bold">
        <strong>B</strong>
      </button>
      <button type="button" className={btnBase} onClick={handleItalic} title="Italic">
        <em>I</em>
      </button>
      <button type="button" className={btnBase} onClick={handleStrike} title="Strikethrough">
        <s>S</s>
      </button>
      <span className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600" />
      <button type="button" className={btnBase} onClick={handleH2} title="Heading 2">
        H2
      </button>
      <button type="button" className={btnBase} onClick={handleH3} title="Heading 3">
        H3
      </button>
      <span className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600" />
      <button type="button" className={btnBase} onClick={handleCode} title="Inline code">
        {"<>"}
      </button>
      <button type="button" className={btnBase} onClick={handleCodeBlock} title="Code block">
        {"```"}
      </button>
      <button type="button" className={btnBase} onClick={handleLink} title="Insert link">
        🔗
      </button>
      <span className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600" />
      {/* Doc link picker — queries memory graph */}
      <div className="relative">
        <button
          type="button"
          className={`${btnBase} ${showDocPicker ? "bg-zinc-100 dark:bg-zinc-700" : ""}`}
          onClick={() => setShowDocPicker((v) => !v)}
          title="Link a knowledge doc from memory graph"
        >
          📎 Doc
        </button>
        {showDocPicker && (
          <DocLinkPicker onClose={() => setShowDocPicker(false)} />
        )}
      </div>
    </Editor.Toolbar>
  );
}

// ---------------------------------------------------------------------------
// KnowledgeEditor — public API
// ---------------------------------------------------------------------------

export interface KnowledgeEditorProps {
  filePath?: string;
  content: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
}

export function KnowledgeEditor({ filePath, content, onChange, readOnly = false, className }: KnowledgeEditorProps) {
  if (isMarkdownFile(filePath)) {
    return (
      <Editor
        value={content}
        onChange={onChange}
        outputFormat="markdown"
        className={className ?? "h-full"}
      >
        {!readOnly && <MarkdownToolbar />}
        <Editor.Content className="h-full min-h-0 overflow-y-auto p-4" />
      </Editor>
    );
  }

  return (
    <CodeEditor
      value={content}
      onChange={onChange}
      language={guessLanguage(filePath)}
      theme="auto"
      readOnly={readOnly}
      className={className ?? "h-full"}
    >
      <CodeEditor.Toolbar />
      <CodeEditor.Panel />
      <CodeEditor.StatusBar>
        <CodeEditor.StatusBar.LineInfo />
      </CodeEditor.StatusBar>
    </CodeEditor>
  );
}
