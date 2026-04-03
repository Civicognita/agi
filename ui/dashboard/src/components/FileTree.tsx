/**
 * FileTree — virtualized directory tree using react-arborist.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Tree } from "react-arborist";
import type { NodeRendererProps } from "react-arborist";
import type { FileNode } from "@/api.js";

export interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function Node({ node, style }: NodeRendererProps<FileNode>) {
  const isDir = node.data.type === "dir";

  return (
    <div
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        if (isDir) {
          node.toggle();
        } else {
          node.activate();
        }
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingRight: 8,
          paddingTop: 1,
          paddingBottom: 1,
          fontSize: 12,
          fontFamily: "monospace",
          cursor: "pointer",
          background: node.isSelected && !isDir ? "var(--color-surface0)" : "transparent",
          color: node.isSelected && !isDir ? "var(--color-foreground)" : "var(--color-muted-foreground)",
          borderRadius: 4,
          height: "100%",
        }}
      >
        <span style={{ width: 14, textAlign: "center", fontSize: 10, opacity: 0.6, flexShrink: 0 }}>
          {isDir ? (node.isOpen ? "\u25BC" : "\u25B6") : " "}
        </span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.data.name}
        </span>
      </div>
    </div>
  );
}

/** Build initial open state — top-level dirs open by default. */
function buildInitialOpenState(nodes: FileNode[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const n of nodes) {
    if (n.type === "dir") map[n.path] = true;
  }
  return map;
}

export function FileTree({ nodes, selectedPath, onSelect }: FileTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);

  // Measure container height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height);
      }
    });
    obs.observe(el);
    setHeight(el.clientHeight);
    return () => obs.disconnect();
  }, []);

  const handleActivate = useCallback(
    (node: { data: FileNode }) => {
      if (node.data.type === "file") {
        onSelect(node.data.path);
      }
    },
    [onSelect],
  );

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: "hidden", paddingTop: 4, paddingBottom: 4 }}>
      <Tree<FileNode>
        data={nodes}
        idAccessor={(d) => d.path}
        childrenAccessor={(d) => d.children ?? null}
        onActivate={handleActivate}
        selection={selectedPath ?? undefined}
        initialOpenState={buildInitialOpenState(nodes)}
        openByDefault={false}
        rowHeight={24}
        indent={12}
        height={height}
        disableDrag
        disableDrop
        disableEdit
        disableMultiSelection
      >
        {Node}
      </Tree>
    </div>
  );
}
