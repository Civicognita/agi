/**
 * StackStrip — compact 1-line Aion context bar between ProjHeader and
 * the mode picker. Shows Aion's current iterative-work task summary
 * for this project (from projectActivity), with the Orb pulse indicator.
 *
 * Not to be confused with the docker "project-stack-strip" which shows
 * attached postgres/redis stacks — that remains in ProjectDetail.
 *
 * s199 — ProjHeader + StackStrip + mode picker restyle.
 */

import { Orb } from "@/components/Orb.js";
import type { ProjectActivity } from "@/types.js";

interface StackStripProps {
  projectPath: string;
  projectActivity: Record<string, ProjectActivity | null>;
}

export function StackStrip({ projectPath, projectActivity }: StackStripProps) {
  const activity = projectActivity[projectPath];
  const summary = activity?.summary ?? null;

  return (
    <div
      className="flex items-center gap-2 px-0 py-1.5 border-b border-agent-line text-xs text-muted-foreground shrink-0"
      style={{ background: "var(--agent-tint)" }}
      data-testid="proj-stack-strip"
    >
      <Orb size={12} pulse={activity !== null && activity !== undefined} className="shrink-0" />
      <span className="truncate">
        {summary ?? "No active tasks"}
      </span>
    </div>
  );
}
