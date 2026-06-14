/**
 * HearthTop — Hearth shell top bar.
 *
 * Replaces the per-route page-title header with a persistent workspace-chip
 * bar + brand mark. All right-side chrome (chat, notifications, upgrade,
 * avatar, etc.) is passed in as `rightContent` so HearthTop owns layout only;
 * root.tsx retains all state.
 */

import type { ReactNode } from "react";
import { SeedMark } from "@/components/SeedMark.js";
import { WorkspaceChip } from "@/components/WorkspaceChip.js";

interface Workspace {
  name: string;
  color: string;
}

interface HearthTopProps {
  workspaces: Workspace[];
  activeIndex: number;
  rightContent: ReactNode;
}

export function HearthTop({ workspaces, activeIndex, rightContent }: HearthTopProps) {
  return (
    <header data-testid="hearth-top" className="h-12 flex items-center gap-3 px-4 border-b border-border sticky top-0 z-[100] bg-card shrink-0">
      <SeedMark size={22} />
      <span className="font-semibold text-sm tracking-tight select-none">Aionima</span>
      <WorkspaceChip workspaces={workspaces} activeIndex={activeIndex} />
      <div className="flex-1" />
      {rightContent}
    </header>
  );
}
