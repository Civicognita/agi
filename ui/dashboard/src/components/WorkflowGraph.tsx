/**
 * WorkflowGraph — Canvas-based rendering of the Taskmaster worker topology.
 * Shows the Taskmaster orchestrator hub connected to domain groups containing
 * worker nodes. Enforced chain edges show mandatory worker sequences.
 * Uses react-fancy Canvas + Card/Badge components for consistent design system styling.
 */

import { useCallback, useState } from "react";
import { Canvas } from "@particle-academy/react-fancy";

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

/* ── Component ──────────────────────────────────────────────────────── */

interface WorkflowGraphProps {
  theme: "light" | "dark";
  config: AionimaConfig | null;
  onSaveConfig: (config: AionimaConfig) => Promise<void>;
  routerStatus?: { costMode: string; escalation: boolean; providers: Array<{ provider: string; healthy: boolean }> };
}

export function WorkflowGraph({ theme: _theme, config, onSaveConfig, routerStatus }: WorkflowGraphProps) {
  const [selectedWorker, setSelectedWorker] = useState<SelectedWorker | null>(null);
  const [, setViewport] = useState<{ panX: number; panY: number; zoom: number } | null>(null);
  const handleViewportChange = useCallback((v: { panX: number; panY: number; zoom: number }) => setViewport(v), []);

  /* ── Layout math ─────────────────────────────────────────────────── */

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

  return (
    <div style={{ width: "100%", height: 600 }}>
      <Canvas
        className="h-full w-full"
        showGrid
        fitOnMount
        minZoom={0.3}
        maxZoom={2}
        onViewportChange={handleViewportChange}
      >
        {/* ── Router layer ─────────────────────────────────────────── */}
        {routerStatus && (
          <>
            {/* Router Hub node */}
            <Canvas.Node id="router-hub" x={routerHubX} y={20} draggable>
              <Card className="border-primary/50 bg-card shadow-md" style={{ width: 220 }}>
                <div className="px-3 py-2 text-center">
                  <div className="text-[13px] font-bold tracking-wide" style={{ color: routerColor }}>
                    AGENT ROUTER
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-1">
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1.5 py-0"
                      style={{ borderColor: routerColor, color: routerColor }}
                    >
                      {routerStatus.costMode.toUpperCase()}
                    </Badge>
                    {routerStatus.escalation && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-muted-foreground text-muted-foreground">
                        ESCALATION
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-1.5 mt-1.5">
                    {routerStatus.providers.map((p) => (
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
            </Canvas.Node>

            {/* Router stage nodes */}
            {stages.map((label, i) => (
              <Canvas.Node
                key={`stage-${i}`}
                id={`stage-${i}`}
                x={stageStartX + i * (stageWidth + stageGap)}
                y={85}
                draggable
              >
                <Card className="border-border/50 bg-card shadow-sm px-3 py-1.5 text-center" style={{ minWidth: stageWidth }}>
                  <div className="text-[9px] text-muted-foreground font-medium tracking-wide">{label}</div>
                </Card>
              </Canvas.Node>
            ))}

            {/* Router hub → stage 0 */}
            <Canvas.Edge
              from="router-hub"
              to="stage-0"
              fromAnchor="bottom"
              toAnchor="top"
              curve="bezier"
              animated
              color="var(--color-primary)"
              strokeWidth={1.5}
            />
            {/* stage 0 → stage 1 */}
            <Canvas.Edge
              from="stage-0"
              to="stage-1"
              fromAnchor="bottom"
              toAnchor="top"
              curve="bezier"
              animated
              color="var(--color-primary)"
              strokeWidth={1.5}
            />
            {/* stage 1 → stage 2 */}
            <Canvas.Edge
              from="stage-1"
              to="stage-2"
              fromAnchor="bottom"
              toAnchor="top"
              curve="bezier"
              animated
              color="var(--color-primary)"
              strokeWidth={1.5}
            />
            {/* stage 2 → taskmaster */}
            <Canvas.Edge
              from="stage-2"
              to="taskmaster"
              fromAnchor="bottom"
              toAnchor="top"
              curve="bezier"
              animated
              color="var(--color-primary)"
              strokeWidth={1.5}
            />
          </>
        )}

        {/* ── Taskmaster node ───────────────────────────────────────── */}
        <Canvas.Node id="taskmaster" x={tmX} y={tmY} draggable>
          <Card className="border-primary/50 bg-card shadow-md" style={{ width: TM_WIDTH }}>
            <div className="px-3 py-2 text-center">
              <div className="text-[13px] font-bold text-primary tracking-wide">TASKMASTER</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {domains.length} domains &middot; {totalWorkers} workers
              </div>
            </div>
          </Card>
        </Canvas.Node>

        {/* ── Domain groups ─────────────────────────────────────────── */}
        {domains.map((domain, di) => {
          const workerCount = domain.workers.length;
          const groupHeight =
            GROUP_PADDING_TOP +
            workerCount * WORKER_HEIGHT +
            (workerCount - 1) * WORKER_GAP +
            GROUP_PADDING_BOTTOM;
          const gx = canvasStartX + di * (GROUP_WIDTH + GROUP_GAP);

          return (
            <Canvas.Node
              key={`group-${domain.id}`}
              id={`group-${domain.id}`}
              x={gx}
              y={groupStartY}
              draggable
            >
              <Card
                className="overflow-hidden shadow-sm"
                style={{
                  width: GROUP_WIDTH,
                  height: groupHeight,
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
                    {workerCount}
                  </Badge>
                </div>

                {/* Worker list */}
                <div className="p-1.5 space-y-0.5">
                  {domain.workers.map((w) => (
                    <button
                      key={w}
                      type="button"
                      className="w-full text-left px-2 py-1.5 rounded text-[10px] text-foreground hover:bg-accent cursor-pointer transition-colors flex items-center gap-2"
                      onClick={() =>
                        setSelectedWorker({
                          nodeId: `${domain.id}-${w}`,
                          domain: domain.id,
                          worker: w,
                          color: domain.color,
                        })
                      }
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: domain.color }} />
                      <span className="font-medium truncate">{w}</span>
                    </button>
                  ))}
                </div>
              </Card>
            </Canvas.Node>
          );
        })}

        {/* ── Taskmaster → domain edges ─────────────────────────────── */}
        {domains.map((domain) => (
          <Canvas.Edge
            key={`tm-to-${domain.id}`}
            from="taskmaster"
            to={`group-${domain.id}`}
            fromAnchor="bottom"
            toAnchor="top"
            curve="step"
            color={domain.color}
            strokeWidth={1}
          />
        ))}

        {/* ── Enforced chain edges ──────────────────────────────────── */}
        {chains.map((chain) => {
          // Workers are rendered inside domain group Cards, not as separate Canvas.Node.
          // Connect group-to-group using the domain prefix of the source/target worker id.
          const sourceDomain = chain.source.split("-")[0];
          const targetDomain = chain.target.split("-")[0];
          return (
            <Canvas.Edge
              key={`chain-${chain.source}-${chain.target}`}
              from={`group-${sourceDomain}`}
              to={`group-${targetDomain}`}
              fromAnchor="right"
              toAnchor="left"
              curve="bezier"
              dashed
              animated
              color="var(--color-overlay0)"
              strokeWidth={1.5}
              label={
                <span className="text-[8px] text-muted-foreground bg-background/80 px-1 rounded">
                  {chain.label}
                </span>
              }
            />
          );
        })}

        <Canvas.Controls />
        <Canvas.Minimap />
      </Canvas>

      <WorkerFlyout
        selected={selectedWorker}
        onClose={() => setSelectedWorker(null)}
        config={config}
        onSaveConfig={onSaveConfig}
      />
    </div>
  );
}
