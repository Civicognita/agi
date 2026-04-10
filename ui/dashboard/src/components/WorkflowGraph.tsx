/**
 * WorkflowGraph — React Flow canvas rendering the Taskmaster worker topology.
 * Shows the Taskmaster orchestrator hub connected to domain groups containing
 * worker nodes. Enforced chain edges show mandatory worker sequences.
 * Uses react-fancy Card/Badge components for consistent design system styling.
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

import { Card } from "@/components/ui/card.js";
import { Badge } from "@/components/ui/badge.js";
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

const GROUP_WIDTH = 190;
const GROUP_GAP = 44;
const WORKER_HEIGHT = 38;
const WORKER_GAP = 6;
const HEADER_HEIGHT = 34;
const GROUP_PADDING_X = 10;
const GROUP_PADDING_TOP = 42;
const GROUP_PADDING_BOTTOM = 10;
const TM_WIDTH = 200;
const TM_HEIGHT = 64;

/* ── Custom nodes (react-fancy styled) ─────────────────────────────── */

function TaskmasterNode({ data }: NodeProps) {
  const d = data as { workerCount: number; domainCount: number };
  return (
    <Card className="border-primary/50 bg-card shadow-md" style={{ width: TM_WIDTH }}>
      <Handle type="source" position={Position.Bottom} style={{ width: 8, height: 8, background: "var(--color-primary)", border: "2px solid var(--color-card)" }} />
      <div className="px-3 py-2 text-center">
        <div className="text-[13px] font-bold text-primary tracking-wide">TASKMASTER</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {d.domainCount} domains &middot; {d.workerCount} workers
        </div>
      </div>
    </Card>
  );
}

function DomainGroupNode({ data }: NodeProps) {
  const d = data as { label: string; color: string; width: number; height: number; workerCount: number };
  return (
    <Card
      className="overflow-hidden shadow-sm"
      style={{
        width: d.width,
        height: d.height,
        borderColor: d.color,
        borderWidth: 1.5,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ width: 6, height: 6, background: d.color, border: "none" }} />
      <div
        className="flex items-center gap-2 px-3"
        style={{ height: HEADER_HEIGHT, background: d.color }}
      >
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--color-crust)" }}>
          {d.label}
        </span>
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 ml-auto" style={{ background: "rgba(0,0,0,0.15)", color: "var(--color-crust)", border: "none" }}>
          {d.workerCount}
        </Badge>
      </div>
    </Card>
  );
}

function WorkerNode({ data }: NodeProps) {
  const d = data as { label: string; color: string; model?: string };
  return (
    <Card className="cursor-pointer hover:border-primary/50 transition-colors shadow-none border-border" style={{ minWidth: GROUP_WIDTH - GROUP_PADDING_X * 2 - 4 }}>
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
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.color }} />
        <span className="text-[11px] font-medium text-foreground truncate">{d.label}</span>
      </div>
    </Card>
  );
}

const nodeTypes: NodeTypes = {
  taskmaster: TaskmasterNode,
  domainGroup: DomainGroupNode,
  worker: WorkerNode,
};

/* ── Graph builder ──────────────────────────────────────────────────── */

function buildGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const totalWorkers = domains.reduce((sum, d) => sum + d.workers.length, 0);

  // Taskmaster hub — centered above domain groups
  const totalWidth = domains.length * GROUP_WIDTH + (domains.length - 1) * GROUP_GAP;
  const tmX = 40 + (totalWidth - TM_WIDTH) / 2;
  const tmY = 20;

  nodes.push({
    id: "taskmaster",
    type: "taskmaster",
    position: { x: tmX, y: tmY },
    data: { workerCount: totalWorkers, domainCount: domains.length },
    draggable: true,
    selectable: false,
    connectable: false,
  });

  const groupStartY = tmY + TM_HEIGHT + 60;
  let groupX = 40;

  for (const domain of domains) {
    const workerCount = domain.workers.length;
    const groupHeight =
      GROUP_PADDING_TOP +
      workerCount * WORKER_HEIGHT +
      (workerCount - 1) * WORKER_GAP +
      GROUP_PADDING_BOTTOM;

    // Domain group container
    nodes.push({
      id: `group-${domain.id}`,
      type: "domainGroup",
      position: { x: groupX, y: groupStartY },
      data: {
        label: domain.label,
        color: domain.color,
        width: GROUP_WIDTH,
        height: groupHeight,
        workerCount,
      },
      draggable: true,
      selectable: false,
      connectable: false,
    });

    // Edge from Taskmaster to domain group
    edges.push({
      id: `tm-to-${domain.id}`,
      source: "taskmaster",
      target: `group-${domain.id}`,
      style: { stroke: domain.color, strokeWidth: 1.5, opacity: 0.4 },
      type: "smoothstep",
    });

    // Worker nodes
    for (let i = 0; i < domain.workers.length; i++) {
      const worker = domain.workers[i];
      nodes.push({
        id: `${domain.id}-${worker}`,
        type: "worker",
        position: {
          x: groupX + GROUP_PADDING_X,
          y: groupStartY + GROUP_PADDING_TOP + i * (WORKER_HEIGHT + WORKER_GAP),
        },
        data: { label: worker, color: domain.color },
        draggable: false,
      });
    }

    groupX += GROUP_WIDTH + GROUP_GAP;
  }

  // Enforced chain edges
  for (const chain of chains) {
    edges.push({
      id: `chain-${chain.source}-${chain.target}`,
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
      if (node.type === "taskmaster") return "var(--color-primary)";
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
