/**
 * ProjHeader — compact identity bar rendered above the mode picker.
 *
 * Shows: project name + category badge + primary repo URL (if set) +
 * hosted URL (if running) + Chat action button.
 *
 * s199 — ProjHeader + StackStrip + mode picker restyle.
 */

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Project } from "@/types.js";

interface ProjHeaderProps {
  project: Project;
  onOpenChat?: (path: string) => void;
}

export function ProjHeader({ project }: ProjHeaderProps) {
  const primaryRepo = project.repos?.[0];
  const shortRepoUrl = primaryRepo?.url
    ? primaryRepo.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\.git$/, "")
    : null;

  const hostedUrl =
    project.hosting?.enabled && project.hosting.status === "running"
      ? (project.hosting.url ?? project.hosting.tunnelUrl ?? null)
      : null;

  const category = project.category ?? project.projectType?.category;

  return (
    <div
      className="flex items-center gap-2.5 py-2 border-b border-border shrink-0 min-w-0"
      data-testid="proj-header"
    >
      <span className="text-sm font-bold tracking-tight truncate">{project.name}</span>
      {category && (
        <Badge variant="secondary" className="text-[10px] shrink-0">
          {category}
        </Badge>
      )}
      {shortRepoUrl && (
        <a
          href={primaryRepo!.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground truncate max-w-[180px] transition-colors"
          data-testid="proj-header-git-url"
        >
          <ExternalLink size={10} className="shrink-0" />
          {shortRepoUrl}
        </a>
      )}
      {hostedUrl && (
        <a
          href={hostedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
          data-testid="proj-header-hosted-url"
        >
          <ExternalLink size={10} className="shrink-0" />
          {hostedUrl}
        </a>
      )}
    </div>
  );
}
