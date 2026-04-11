/**
 * DocsPage — browse and read documentation files.
 * Two-column layout: file tree sidebar + rendered markdown viewer.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TreeNav } from "@particle-academy/react-fancy";
import { fetchDocsTree, fetchFile } from "@/api.js";
import type { FileNode } from "@/api.js";
import { markdownComponents } from "@/lib/markdown.js";
import { useIsMobile } from "@/hooks.js";

type TreeNodeData = { id: string; label: string; type: "file" | "folder"; ext?: string; children?: TreeNodeData[] };
function mapNode(n: FileNode): TreeNodeData {
  return { id: n.path, label: n.name, type: n.type === "dir" ? "folder" : "file", ext: n.ext, children: n.children?.map(mapNode) };
}

export default function DocsPage() {
  const isMobile = useIsMobile();

  const [treeNodes, setTreeNodes] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(true);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mdComponents = useMemo(() => markdownComponents({ prose: true }), []);

  // Load file tree on mount
  useEffect(() => {
    fetchDocsTree()
      .then(setTreeNodes)
      .catch(() => setTreeNodes([]))
      .finally(() => setTreeLoading(false));
  }, []);

  // Load file when selection changes
  const handleSelect = useCallback((path: string) => {
    // Only select markdown files
    if (!path.endsWith(".md")) return;
    setSelectedPath(path);
  }, []);

  useEffect(() => {
    if (!selectedPath) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchFile(selectedPath)
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setContent("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedPath]);

  const fileName = selectedPath?.split("/").pop() ?? "";

  if (isMobile) {
    return (
      <div style={{ height: "calc(100dvh - 57px)", overflow: "hidden", margin: "-12px" }}>
        {showTree || !selectedPath ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--color-card)" }}>
            <div style={{ padding: "10px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted-foreground)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              Documentation
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {treeLoading ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--color-muted-foreground)" }}>Loading...</div>
              ) : treeNodes.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--color-muted-foreground)" }}>No docs found</div>
              ) : (
                <TreeNav
                  nodes={treeNodes.map(mapNode) as never}
                  selectedId={selectedPath ?? undefined}
                  onSelect={(id: string, node: { type?: string }) => { if (node.type === "file") { handleSelect(id); setShowTree(false); } }}
                  defaultExpandAll
                  showIcons
                  indentSize={14}
                />
              )}
            </div>
          </div>
        ) : (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-card)", flexShrink: 0 }}>
              <button onClick={() => setShowTree(true)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-foreground)", fontSize: 11, cursor: "pointer" }}>
                Files
              </button>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-foreground)" }}>{fileName}</span>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {loading && <div style={{ padding: 16, color: "var(--color-muted-foreground)", fontSize: 13 }}>Loading...</div>}
              {error && <div style={{ padding: 16, color: "var(--color-red)", fontSize: 13 }}>{error}</div>}
              {!loading && !error && (
                <div style={{ padding: "24px 16px", maxWidth: 860 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{content}</ReactMarkdown>
                </div>
              )}
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
        margin: "-24px",
        height: "calc(100dvh - 57px)",
        overflow: "hidden",
      }}
    >
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
          Documentation
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {treeLoading ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--color-muted-foreground)" }}>
              Loading...
            </div>
          ) : treeNodes.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--color-muted-foreground)" }}>
              No docs found
            </div>
          ) : (
            <TreeNav
              nodes={treeNodes.map(mapNode) as never}
              selectedId={selectedPath ?? undefined}
              onSelect={(id: string, node: { type?: string }) => { if (node.type === "file") handleSelect(id); }}
              defaultExpandAll
              showIcons
              indentSize={14}
            />
          )}
        </div>
      </div>

      {/* Main — rendered markdown */}
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
          </div>
        )}

        {/* Content area */}
        <div style={{ flex: 1, overflow: "auto" }}>
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
              Select a document to read
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
            <div style={{ padding: "24px 32px", maxWidth: 860 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
