/**
 * WorkflowGraph — React Flow canvas rendering the worker topology.
 * Shows domain groups with worker nodes and enforced chain edges.
 * Click a worker node to open the WorkerFlyout with metadata and model config.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  type NodeMouseHandler,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { WorkerFlyout, type SelectedWorker } from "./WorkerFlyout";
import type { AionimaConfig } from "@/types";

/* ── Domain definitions ─────────────────────────────────────────────── */

interface Domain {
  id: string;
  label: string;
  color: string;
  workers: string[];
}

const domains: Domain[] = [
  { id: "strat", label: "Strategy", color: "var(--color-yellow)", workers: ["planner", "prioritizer"] },
  { id: "code", label: "Code", color: "var(--color-blue)", workers: ["engineer", "hacker", "reviewer", "tester"] },
  { id: "comm", label: "Communication", color: "var(--color-teal)", workers: ["writer.tech", "writer.policy", "editor"] },
  { id: "data", label: "Data", color: "var(--color-peach)", workers: ["modeler", "migrator"] },
  { id: "k", label: "Knowledge", color: "var(--color-lavender)", workers: ["analyst", "cryptologist", "librarian", "linguist"] },
  { id: "gov", label: "Governance", color: "var(--color-mauve)", workers: ["auditor", "archivist"] },
  { id: "ops", label: "Operations", color: "var(--color-green)", workers: ["deployer", "custodian", "syncer"] },
  { id: "ux", label: "UX", color: "var(--color-flamingo)", workers: ["designer.web", "designer.cli"] },
];

const chains = [
  { source: "code-hacker", target: "code-tester", label: "enforced" },
  { source: "comm-writer.tech", target: "comm-editor", label: "enforced" },
  { source: "comm-writer.policy", target: "comm-editor", label: "enforced" },
  { source: "data-modeler", target: "k-linguist", label: "enforced (cross-domain)" },
  { source: "gov-auditor", target: "gov-archivist", label: "enforced" },
];

/* ── Layout constants ───────────────────────────────────────────────── */

const GROUP_WIDTH = 180;
const GROUP_GAP = 40;
const WORKER_HEIGHT = 36;
const WORKER_GAP = 8;
const HEADER_HEIGHT = 36;
const GROUP_PADDING_X = 12;
const GROUP_PADDING_TOP = 44;
const GROUP_PADDING_BOTTOM = 12;
const START_X = 40;
const START_Y = 40;

/* ── Custom nodes ───────────────────────────────────────────────────── */

function DomainGroupNode({ data }: NodeProps) {
  const d = data as { label: string; color: string; width: number; height: number };
  return (
    <div
      style={{
        width: d.width,
        height: d.height,
        borderRadius: 12,
        border: `1.5px solid ${d.color}`,
        background: "var(--color-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: HEADER_HEIGHT,
          background: d.color,
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
          fontSize: 12,
          fontWeight: 700,
          color: "var(--color-crust)",
          letterSpacing: "0.03em",
          textTransform: "uppercase",
        }}
      >
        {d.label}
      </div>
    </div>
  );
}

function WorkerNode({ data }: NodeProps) {
  const d = data as { label: string; color: string };
  return (
    <div
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        border: `1px solid var(--color-border)`,
        background: "var(--color-card)",
        fontSize: 12,
        fontWeight: 500,
        color: "var(--color-foreground)",
        minWidth: GROUP_WIDTH - GROUP_PADDING_X * 2 - 4,
        textAlign: "center",
        position: "relative",
        cursor: "pointer",
      }}
    >
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 6, height: 6, background: d.color, border: "none" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 6, height: 6, background: d.color, border: "none" }}
      />
      {d.label}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  domainGroup: DomainGroupNode,
  worker: WorkerNode,
};

/* ── Graph builder ──────────────────────────────────────────────────── */

function buildGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  let groupX = START_X;

  for (const domain of domains) {
    const workerCount = domain.workers.length;
    const groupHeight =
      GROUP_PADDING_TOP +
      workerCount * WORKER_HEIGHT +
      (workerCount - 1) * WORKER_GAP +
      GROUP_PADDING_BOTTOM;

    // Domain group (background container)
    nodes.push({
      id: `group-${domain.id}`,
      type: "domainGroup",
      position: { x: groupX, y: START_Y },
      data: {
        label: domain.label,
        color: domain.color,
        width: GROUP_WIDTH,
        height: groupHeight,
      },
      draggable: true,
      selectable: false,
      connectable: false,
    });

    // Worker nodes inside the group
    for (let i = 0; i < domain.workers.length; i++) {
      const worker = domain.workers[i];
      nodes.push({
        id: `${domain.id}-${worker}`,
        type: "worker",
        position: {
          x: groupX + GROUP_PADDING_X,
          y: START_Y + GROUP_PADDING_TOP + i * (WORKER_HEIGHT + WORKER_GAP),
        },
        data: { label: worker, color: domain.color },
        draggable: false,
        parentId: undefined,
      });
    }

    groupX += GROUP_WIDTH + GROUP_GAP;
  }

  // Enforced chain edges
  for (const chain of chains) {
    edges.push({
      id: `edge-${chain.source}-${chain.target}`,
      source: chain.source,
      target: chain.target,
      label: chain.label,
      animated: true,
      style: { stroke: "var(--color-overlay0)", strokeWidth: 1.5, strokeDasharray: "6 3" },
      labelStyle: { fontSize: 9, fill: "var(--color-muted-foreground)", fontWeight: 500 },
      labelBgStyle: { fill: "var(--color-background)", fillOpacity: 0.85 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    });
  }

  return { nodes, edges };
}

/* ── Component ──────────────────────────────────────────────────────── */

interface WorkflowGraphProps {
  theme: "light" | "dark";
  config: AionimaConfig | null;
  onSaveConfig: (config: AionimaConfig) => Promise<void>;
}

export function WorkflowGraph({ theme, config, onSaveConfig }: WorkflowGraphProps) {
  const { nodes, edges } = useMemo(() => buildGraph(), []);
  const colorMode = theme === "light" ? "light" : "dark";
  const [selectedWorker, setSelectedWorker] = useState<SelectedWorker | null>(null);

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type !== "worker") return;
    const dashIdx = node.id.indexOf("-");
    if (dashIdx < 0) return;
    const domain = node.id.slice(0, dashIdx);
    const worker = node.id.slice(dashIdx + 1);
    const d = node.data as { color: string };
    setSelectedWorker({ nodeId: node.id, domain, worker, color: d.color });
  }, []);

  const minimapNodeColor = useCallback(
    (node: Node) => {
      if (node.type === "domainGroup") {
        const d = node.data as { color: string };
        return d.color;
      }
      return "var(--color-surface1)";
    },
    [],
  );

  return (
    <div style={{ width: "100%", height: "calc(100vh - 120px)" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        colorMode={colorMode}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor={theme === "dark" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)"}
          style={{ borderRadius: 8 }}
        />
      </ReactFlow>
      <WorkerFlyout
        selected={selectedWorker}
        onClose={() => setSelectedWorker(null)}
        config={config}
        onSaveConfig={onSaveConfig}
      />
    </div>
  );
}
