/**
 * Knowledge page — browse and edit .aionima/ PRIME knowledge files.
 * Two-column layout with file tree sidebar and CodeMirror editor.
 */

import { useCallback, useEffect, useState } from "react";
import { TreeNav } from "@particle-academy/react-fancy";
import { FileEditor } from "@/components/FileEditor.js";
import { fetchFile, fetchFileTree, saveFile } from "@/api.js";
import type { FileNode } from "@/api.js";
import { useRootContext } from "./root.js";
import { useIsMobile } from "@/hooks.js";
import { DevNote } from "@/components/ui/dev-notes";

type TreeNodeData = { id: string; label: string; type: "file" | "folder"; ext?: string; children?: TreeNodeData[] };
function mapNode(n: FileNode): TreeNodeData {
  return { id: n.path, label: n.name, type: n.type === "dir" ? "folder" : "file", ext: n.ext, children: n.children?.map(mapNode) };
}

export default function KnowledgePage() {
  const { theme } = useRootContext();
  const isMobile = useIsMobile();

  const [treeNodes, setTreeNodes] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(true);
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = draft !== content;

  // Load file tree on mount
  useEffect(() => {
    fetchFileTree()
      .then(setTreeNodes)
      .catch(() => setTreeNodes([]))
      .finally(() => setTreeLoading(false));
  }, []);

  // Load file when selection changes
  useEffect(() => {
    if (!selectedPath) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchFile(selectedPath)
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
        setDraft(result.content);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setContent("");
        setDraft("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedPath]);

  const handleSave = useCallback(async () => {
    if (!selectedPath || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await saveFile(selectedPath, draft);
      setContent(draft);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [selectedPath, draft, dirty]);

  const fileName = selectedPath?.split("/").pop() ?? "";

  if (isMobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {showTree || !selectedPath ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--color-card)" }}>
            <div style={{ padding: "10px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted-foreground)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              Knowledge
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {treeLoading ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--color-muted-foreground)" }}>Loading...</div>
              ) : treeNodes.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--color-muted-foreground)" }}>No files found</div>
              ) : (
                <TreeNav
                  nodes={treeNodes.map(mapNode) as never}
                  selectedId={selectedPath ?? undefined}
                  onSelect={(id: string, node: { type?: string }) => { if (node.type === "file") { setSelectedPath(id); setShowTree(false); } }}
                  defaultExpandAll
                  showIcons
                  indentSize={14}
                />
              )}
            </div>
          </div>
        ) : (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            {/* Back + tab bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-card)", flexShrink: 0 }}>
              <button onClick={() => setShowTree(true)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-foreground)", fontSize: 11, cursor: "pointer" }}>
                Files
              </button>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-foreground)" }}>{fileName}</span>
              {dirty && (
                <>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "var(--color-warning)", color: "var(--color-crust)", flexShrink: 0 }}>modified</span>
                  <button onClick={() => setDraft(content)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-foreground)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>Discard</button>
                  <button onClick={handleSave} disabled={saving} style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "var(--color-blue)", color: "var(--color-crust)", fontSize: 11, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1, flexShrink: 0 }}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                </>
              )}
            </div>
            {/* Editor */}
            <div style={{ flex: 1, overflow: "hidden" }}>
              {loading && <div style={{ padding: 16, color: "var(--color-muted-foreground)", fontSize: 13 }}>Loading...</div>}
              {error && <div style={{ padding: 16, color: "var(--color-red)", fontSize: 13 }}>{error}</div>}
              {!loading && !error && <FileEditor filePath={selectedPath} content={content} theme={theme} onChange={setDraft} onSave={handleSave} />}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop: existing return (unchanged)
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <DevNote heading="PRIME knowledge editor — careful with edits" kind="warning" scope="knowledge">
        This page edits files in `~/.aionima/` directly. Save writes synchronously; no undo beyond
        Discard while the buffer is dirty. PRIME corpus changes feed Aion's system prompt at next
        invocation — verify edits against the prime.md doctrine before saving.
      </DevNote>
      <DevNote heading="Per-project chat history is separate (s130)" kind="info" scope="knowledge">
        Project-bound chat sessions live at `&lt;projectPath&gt;/chat/` (cycle 143 boot-time mass
        migration). The s140 layout completes the move. This Knowledge page only edits the global
        PRIME corpus, not per-project files.
      </DevNote>
      {/* Sidebar — file tree */}
      <div
        style={{
          width: 256,
          flexShrink: 0,
          borderRight: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-card)",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--color-muted-foreground)",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          Knowledge
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {treeLoading ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--color-muted-foreground)" }}>
              Loading...
            </div>
          ) : treeNodes.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--color-muted-foreground)" }}>
              No files found
            </div>
          ) : (
            <TreeNav
              nodes={treeNodes.map(mapNode) as never}
              selectedId={selectedPath ?? undefined}
              onSelect={(id: string, node: { type?: string }) => { if (node.type === "file") setSelectedPath(id); }}
              defaultExpandAll
              showIcons
              indentSize={14}
            />
          )}
        </div>
      </div>

      {/* Main — editor area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Tab bar */}
        {selectedPath && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderBottom: "1px solid var(--color-border)",
              background: "var(--color-card)",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-foreground)" }}>
              {fileName}
            </span>
            <span
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "var(--color-muted-foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {selectedPath}
            </span>
            {dirty && (
              <>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "var(--color-warning)",
                    color: "var(--color-crust)",
                    flexShrink: 0,
                  }}
                >
                  modified
                </span>
                <button
                  onClick={() => setDraft(content)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid var(--color-border)",
                    background: "transparent",
                    color: "var(--color-foreground)",
                    fontSize: 11,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  Discard
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "none",
                    background: "var(--color-blue)",
                    color: "var(--color-crust)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.6 : 1,
                    flexShrink: 0,
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Editor content */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {!selectedPath && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--color-muted-foreground)",
                fontSize: 13,
              }}
            >
              Select a file to edit
            </div>
          )}
          {selectedPath && loading && (
            <div style={{ padding: 16, color: "var(--color-muted-foreground)", fontSize: 13 }}>
              Loading...
            </div>
          )}
          {selectedPath && error && (
            <div style={{ padding: 16, color: "var(--color-red)", fontSize: 13 }}>
              {error}
            </div>
          )}
          {selectedPath && !loading && !error && (
            <FileEditor
              filePath={selectedPath}
              content={content}
              theme={theme}
              onChange={setDraft}
              onSave={handleSave}
            />
          )}
        </div>
      </div>
    </div>
  );
}
