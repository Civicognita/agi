/**
 * Knowledge page — browse and edit .aionima/ PRIME knowledge files.
 * Two-column layout with file tree sidebar and smart KnowledgeEditor.
 */

import { useCallback, useEffect, useState } from "react";
import { TreeNav } from "@particle-academy/react-fancy";
import { KnowledgeEditor } from "@/components/KnowledgeEditor.js";
import { fetchFile, fetchFileTree, saveFile } from "@/api.js";
import type { FileNode } from "@/api.js";
import { useIsMobile } from "@/hooks.js";
import { DevNote } from "@/components/ui/dev-notes";

type TreeNodeData = { id: string; label: string; type: "file" | "folder"; ext?: string; children?: TreeNodeData[] };
function mapNode(n: FileNode): TreeNodeData {
  return { id: n.path, label: n.name, type: n.type === "dir" ? "folder" : "file", ext: n.ext, children: n.children?.map(mapNode) };
}

export default function KnowledgePage() {
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

  // Load the PRIME corpus tree on mount. "knowledge" root = the full Aionima
  // knowledge graph (domains, inputs, COA doctrine) served read-only by the
  // gateway. Previously this called fetchFileTree() with no root, which the
  // built-in endpoint 403s (it only serves docs/ or knowledge/), so the catch
  // swallowed it to [] and the page rendered "No files found".
  useEffect(() => {
    fetchFileTree("knowledge")
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
              {!loading && !error && <KnowledgeEditor filePath={selectedPath ?? undefined} content={content} onChange={setDraft} readOnly />}
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
      <DevNote heading="Read-only PRIME corpus browser (was 403-broken)" kind="info" scope="knowledge">
        Browses the full Aionima knowledge graph — the PRIME corpus (domains, inputs, COA doctrine)
        served read-only from the gateway&apos;s `knowledge` file root. Until this fix the page called
        `fetchFileTree()` with no root, which the built-in endpoint 403s (it only serves `docs/` or
        `knowledge/`); the error was swallowed and the page showed &quot;No files found&quot;. View-only by
        design: PRIME is read-only at runtime, so the editor renders with `readOnly` and there is no
        Save. Editing the corpus stays out-of-band (the editor plugin / git).
      </DevNote>
      <DevNote heading="Per-project chat history is separate (s130)" kind="info" scope="knowledge">
        Project-bound chat sessions live at `&lt;projectPath&gt;/k/chat/` (cycle 143 boot-time mass
        migration). chat/ stays under k/ in the s140 layout. This Knowledge page only surfaces the
        global PRIME corpus, not per-project files.
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
            <KnowledgeEditor
              filePath={selectedPath}
              content={content}
              onChange={setDraft}
              readOnly
            />
          )}
        </div>
      </div>
    </div>
  );
}
