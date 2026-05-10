/**
 * SupportCanvas — s137 t531.
 *
 * Two-column docs surface that renders inside the chat flyout's
 * AgentCanvas section when help mode is active. Mirrors the standalone
 * DocsPage shape but compact + flyout-friendly:
 *   - Left: docs tree (TreeNav primitive) listing `agi/docs/human/*.md`
 *     and `agi/docs/agents/*.md` (same source as DocsPage)
 *   - Right: reader pane that renders the selected doc's markdown
 *
 * Inside the flyout (~50% viewport width) the layout switches to a
 * single column with toggleable tree, mirroring DocsPage's mobile path.
 *
 * Wiring: rendered by AgentCanvas when its surface is `{ kind: "support" }`.
 * The chat layer (server.ts) is responsible for setting that surface
 * when a help-mode chat session opens — separate slice (Phase 2 of t531
 * follow-up).
 */

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TreeNav } from "@particle-academy/react-fancy";
import { fetchDocsTree, fetchFile } from "@/api.js";
import type { FileNode } from "@/api.js";
import { markdownComponents } from "@/lib/markdown.js";

type TreeNodeData = { id: string; label: string; type: "file" | "folder"; ext?: string; children?: TreeNodeData[] };

function mapNode(n: FileNode): TreeNodeData {
  return {
    id: n.path,
    label: n.name,
    type: n.type === "dir" ? "folder" : "file",
    ext: n.ext,
    children: n.children?.map(mapNode),
  };
}

interface SupportCanvasProps {
  /** Optional initial doc to load (e.g. derived from page-context).
   *  Caller may pre-resolve `help:projects browser` to e.g. `human/dashboard.md`. */
  initialPath?: string;
  className?: string;
}

export function SupportCanvas({ initialPath, className }: SupportCanvasProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialPath ?? null);
  const [content, setContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(true);

  const mdComponents = useMemo(() => markdownComponents({ prose: true }), []);

  // Load tree on mount
  useEffect(() => {
    let cancelled = false;
    fetchDocsTree()
      .then((nodes) => {
        if (cancelled) return;
        setTree(nodes);
      })
      .catch(() => {
        if (cancelled) return;
        setTree([]);
      })
      .finally(() => {
        if (cancelled) return;
        setTreeLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Load content when selectedPath changes
  useEffect(() => {
    if (selectedPath === null) {
      setContent("");
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    fetchFile(selectedPath)
      .then((text) => {
        if (cancelled) return;
        setContent(text ?? "");
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setContentLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedPath]);

  const treeData = useMemo(() => tree.map(mapNode), [tree]);

  return (
    <div
      className={`h-full w-full flex flex-col bg-background ${className ?? ""}`}
      data-testid="support-canvas"
    >
      {/* Header strip with tree toggle */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          onClick={() => { setShowTree((s) => !s); }}
          className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-secondary"
          data-testid="support-canvas-tree-toggle"
        >
          {showTree ? "Hide tree" : "Show tree"}
        </button>
        <span className="text-[12px] text-muted-foreground truncate flex-1">
          {selectedPath ?? "Select a doc to read"}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Tree pane */}
        {showTree && (
          <div
            className="w-[260px] border-r border-border overflow-y-auto"
            data-testid="support-canvas-tree"
          >
            {treeLoading && <p className="text-[12px] text-muted-foreground p-3">Loading docs…</p>}
            {!treeLoading && tree.length === 0 && (
              <p className="text-[12px] text-muted-foreground p-3">No docs found.</p>
            )}
            {!treeLoading && treeData.length > 0 && (
              <TreeNav
                nodes={treeData}
                selectedId={selectedPath}
                onSelect={(id) => {
                  const node = findNode(treeData, id);
                  if (node?.type === "file") setSelectedPath(id);
                }}
              />
            )}
          </div>
        )}

        {/* Reader pane */}
        <div
          className="flex-1 min-w-0 overflow-y-auto p-4"
          data-testid="support-canvas-reader"
        >
          {selectedPath === null && !contentLoading && (
            <p className="text-[12px] text-muted-foreground">Pick a doc from the tree to read.</p>
          )}
          {contentLoading && (
            <p className="text-[12px] text-muted-foreground">Loading…</p>
          )}
          {error && (
            <p className="text-[12px] text-destructive">Error: {error}</p>
          )}
          {selectedPath !== null && !contentLoading && !error && (
            <div className="prose prose-sm max-w-none">
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

function findNode(nodes: TreeNodeData[], id: string): TreeNodeData | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}
