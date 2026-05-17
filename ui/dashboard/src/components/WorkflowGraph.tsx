/**
 * WorkflowGraph — fancy-flow FlowCanvas rendering of the Taskmaster
 * worker topology. Shows the Taskmaster orchestrator hub connected to
 * domain groups containing worker nodes. Enforced chain edges show
 * mandatory worker sequences.
 *
 * Migrated 2026-05-14 from react-fancy `Canvas` (removed in 3.0.0) to
 * `@particle-academy/fancy-flow` `FlowCanvas`. The xyflow-backed engine
 * is purpose-built for node-graph rendering — same positions, same
 * edges, custom node renderers preserve the rich Card-based UI.
 */

import { useCallback, useMemo, useState } from "react";
import { FlowCanvas, type FlowNode, type FlowEdge } from "@particle-academy/fancy-flow";
import { Handle, Position, type NodeProps } from "@xyflow/react";

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
const GROUP_PADDING_TOP = 42;
const GROUP_PADDING_BOTTOM = 10;
const TM_WIDTH = 200;
const TM_HEIGHT = 64;

/* ── Custom node renderers ──────────────────────────────────────────── */

interface RouterNodeData {
  costMode: string;
  escalation: boolean;
  providers: Array<{ provider: string; healthy: boolean }>;
  routerColor: string;
}

function RouterNode({ data }: NodeProps) {
  const d = data as unknown as RouterNodeData;
  return (
    <>
      <Card className="border-primary/50 bg-card shadow-md" style={{ width: 220 }}>
        <div className="px-3 py-2 text-center">
          <div className="text-[13px] font-bold tracking-wide" style={{ color: d.routerColor }}>
            AGENT ROUTER
          </div>
          <div className="flex items-center justify-center gap-2 mt-1">
            <Badge
              variant="outline"
              className="text-[9px] px-1.5 py-0"
              style={{ borderColor: d.routerColor, color: d.routerColor }}
            >
              {d.costMode.toUpperCase()}
            </Badge>
            {d.escalation && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-muted-foreground text-muted-foreground">
                ESCALATION
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-center gap-1.5 mt-1.5">
            {d.providers.map((p) => (
              <div key={p.provider} className="flex items-center gap-0.5">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: p.healthy ? "var(--color-green)" : "var(--color-red)" }}
                />
                <span className="text-[8px] text-muted-foreground">{p.provider}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

interface StageNodeData { label: string }

function StageNode({ data }: NodeProps) {
  const d = data as unknown as StageNodeData;
  return (
    <>
      <Card className="border-border/50 bg-card shadow-sm px-3 py-1.5 text-center" style={{ minWidth: 70 }}>
        <div className="text-[9px] text-muted-foreground font-medium tracking-wide">{d.label}</div>
      </Card>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

interface TaskmasterNodeData { domainCount: number; workerCount: number }

function TaskmasterNode({ data }: NodeProps) {
  const d = data as unknown as TaskmasterNodeData;
  return (
    <>
      <Card className="border-primary/50 bg-card shadow-md" style={{ width: TM_WIDTH }}>
        <div className="px-3 py-2 text-center">
          <div className="text-[13px] font-bold text-primary tracking-wide">TASKMASTER</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {d.domainCount} domains &middot; {d.workerCount} workers
          </div>
        </div>
      </Card>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

interface DomainGroupNodeData {
  domain: Domain;
  groupHeight: number;
  onWorkerClick: (worker: string, color: string) => void;
}

function DomainGroupNode({ data }: NodeProps) {
  const d = data as unknown as DomainGroupNodeData;
  const domain = d.domain;
  return (
    <>
      <Card
        className="overflow-hidden shadow-sm"
        style={{
          width: GROUP_WIDTH,
          height: d.groupHeight,
          borderColor: domain.color,
          borderWidth: 1.5,
        }}
      >
        {/* Domain header */}
        <div
          className="flex items-center gap-2 px-3"
          style={{ height: HEADER_HEIGHT, background: domain.color }}
        >
          <span
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-crust)" }}
          >
            {domain.label}
          </span>
          <Badge
            variant="secondary"
            className="text-[9px] px-1.5 py-0 h-4 ml-auto"
            style={{ background: "rgba(0,0,0,0.15)", color: "var(--color-crust)", border: "none" }}
          >
            {domain.workers.length}
          </Badge>
        </div>

        {/* Worker list */}
        <div className="p-1.5 space-y-0.5">
          {domain.workers.map((w) => (
            <button
              key={w}
              type="button"
              className="w-full text-left px-2 py-1.5 rounded text-[10px] text-foreground hover:bg-accent cursor-pointer transition-colors flex items-center gap-2"
              onClick={(e) => {
                e.stopPropagation();
                d.onWorkerClick(w, domain.color);
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: domain.color }} />
              <span className="font-medium truncate">{w}</span>
            </button>
          ))}
        </div>
      </Card>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} id="right" />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} id="left" />
    </>
  );
}

const nodeTypes = {
  router: RouterNode,
  stage: StageNode,
  taskmaster: TaskmasterNode,
  domainGroup: DomainGroupNode,
};

/* ── Component ──────────────────────────────────────────────────────── */

interface WorkflowGraphProps {
  theme: "light" | "dark";
  config: AionimaConfig | null;
  onSaveConfig: (config: AionimaConfig) => Promise<void>;
  routerStatus?: { costMode: string; escalation: boolean; providers: Array<{ provider: string; healthy: boolean }> };
}

export function WorkflowGraph({ theme: _theme, config, onSaveConfig, routerStatus }: WorkflowGraphProps) {
  const [selectedWorker, setSelectedWorker] = useState<SelectedWorker | null>(null);

  const handleWorkerClick = useCallback((worker: string, color: string) => {
    const domain = domains.find((d) => d.workers.includes(worker));
    if (!domain) return;
    setSelectedWorker({
      nodeId: `${domain.id}-${worker}`,
      domain: domain.id,
      worker,
      color,
    });
  }, []);

  const { nodes, edges } = useMemo(() => {
    const totalWorkers = domains.reduce((sum, d) => sum + d.workers.length, 0);
    const totalWidth = domains.length * GROUP_WIDTH + (domains.length - 1) * GROUP_GAP;
    const canvasStartX = 40;

    const ROUTER_OFFSET = routerStatus ? 140 : 0;
    const tmX = canvasStartX + (totalWidth - TM_WIDTH) / 2;
    const tmY = 20 + ROUTER_OFFSET;

    // Router layer positions
    const stages = ["Classify", "Select", "Execute"];
    const stageWidth = 70;
    const stageGap = 30;
    const totalStageWidth = stages.length * stageWidth + (stages.length - 1) * stageGap;
    const stageStartX = canvasStartX + totalWidth / 2 - totalStageWidth / 2;
    const routerHubX = canvasStartX + totalWidth / 2 - 110;

    // Domain group positions
    const groupStartY = tmY + TM_HEIGHT + 60;

    const modeColors: Record<string, string> = {
      local: "var(--color-green)",
      economy: "var(--color-yellow)",
      balanced: "var(--color-blue)",
      max: "var(--color-mauve)",
    };
    const routerColor = routerStatus ? (modeColors[routerStatus.costMode] ?? "var(--color-blue)") : "var(--color-blue)";

    const nodesList: FlowNode[] = [];
    const edgesList: FlowEdge[] = [];

    if (routerStatus) {
      nodesList.push({
        id: "router-hub",
        type: "router",
        position: { x: routerHubX, y: 20 },
        data: {
          costMode: routerStatus.costMode,
          escalation: routerStatus.escalation,
          providers: routerStatus.providers,
          routerColor,
          label: "Agent Router",
        },
      });

      stages.forEach((label, i) => {
        nodesList.push({
          id: `stage-${i}`,
          type: "stage",
          position: { x: stageStartX + i * (stageWidth + stageGap), y: 85 },
          data: { label },
        });
      });

      // Router → stages → taskmaster chain
      edgesList.push(
        { id: "rh-s0", source: "router-hub", target: "stage-0", animated: true, style: { stroke: "var(--color-primary)", strokeWidth: 1.5 } },
        { id: "s0-s1", source: "stage-0", target: "stage-1", animated: true, style: { stroke: "var(--color-primary)", strokeWidth: 1.5 } },
        { id: "s1-s2", source: "stage-1", target: "stage-2", animated: true, style: { stroke: "var(--color-primary)", strokeWidth: 1.5 } },
        { id: "s2-tm", source: "stage-2", target: "taskmaster", animated: true, style: { stroke: "var(--color-primary)", strokeWidth: 1.5 } },
      );
    }

    nodesList.push({
      id: "taskmaster",
      type: "taskmaster",
      position: { x: tmX, y: tmY },
      data: {
        domainCount: domains.length,
        workerCount: totalWorkers,
        label: "Taskmaster",
      },
    });

    domains.forEach((domain, di) => {
      const workerCount = domain.workers.length;
      const groupHeight =
        GROUP_PADDING_TOP +
        workerCount * WORKER_HEIGHT +
        (workerCount - 1) * WORKER_GAP +
        GROUP_PADDING_BOTTOM;
      const gx = canvasStartX + di * (GROUP_WIDTH + GROUP_GAP);

      nodesList.push({
        id: `group-${domain.id}`,
        type: "domainGroup",
        position: { x: gx, y: groupStartY },
        data: {
          domain,
          groupHeight,
          onWorkerClick: handleWorkerClick,
          label: domain.label,
        },
      });

      edgesList.push({
        id: `tm-to-${domain.id}`,
        source: "taskmaster",
        target: `group-${domain.id}`,
        type: "step",
        style: { stroke: domain.color, strokeWidth: 1 },
      });
    });

    chains.forEach((chain) => {
      const sourceDomain = chain.source.split("-")[0];
      const targetDomain = chain.target.split("-")[0];
      edgesList.push({
        id: `chain-${chain.source}-${chain.target}`,
        source: `group-${sourceDomain}`,
        target: `group-${targetDomain}`,
        sourceHandle: "right",
        targetHandle: "left",
        animated: true,
        label: chain.label,
        style: { stroke: "var(--color-overlay0)", strokeWidth: 1.5, strokeDasharray: "4 4" },
        labelStyle: { fontSize: 8, fill: "var(--color-muted-foreground)" },
      });
    });

    return { nodes: nodesList, edges: edgesList };
  }, [routerStatus, handleWorkerClick]);

  return (
    <div style={{ width: "100%", height: 600 }}>
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        height={600}
        showControls
        showMinimap
      />

      <WorkerFlyout
        selected={selectedWorker}
        onClose={() => setSelectedWorker(null)}
        config={config}
        onSaveConfig={onSaveConfig}
      />
    </div>
  );
}
