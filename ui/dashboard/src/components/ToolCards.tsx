/**
 * ToolCards — tool-specific visual card renderers for live and frozen tool activity.
 *
 * Each tool type gets a unique card style (file, terminal, search, git, etc.).
 * Cards show status indicators, key parameters, and timing info.
 */

import { type FC, useMemo } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCard {
  id: string;
  toolName: string;
  loopIteration: number;
  toolIndex: number;
  status: "running" | "complete" | "error";
  summary?: string;
  toolInput?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  timestamp: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsed(start: string, end?: string): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (ms < 1000) return `${String(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "TS", tsx: "TSX", js: "JS", jsx: "JSX", py: "PY", rs: "RS",
    go: "GO", json: "JSON", md: "MD", yaml: "YAML", yml: "YAML",
    toml: "TOML", sh: "SH", css: "CSS", html: "HTML", sql: "SQL",
  };
  return map[ext] ?? ext.toUpperCase();
}

function truncatePath(path: string, maxLen = 50): string {
  if (typeof path !== "string") return "";
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 2) return `...${path.slice(-maxLen + 3)}`;
  return `.../${parts.slice(-2).join("/")}`;
}

function truncateCommand(cmd: string, maxLen = 60): string {
  if (typeof cmd !== "string") return "";
  if (cmd.length <= maxLen) return cmd;
  return cmd.slice(0, maxLen - 3) + "...";
}

// ---------------------------------------------------------------------------
// Status indicator
// ---------------------------------------------------------------------------

const StatusDot: FC<{ status: "running" | "complete" | "error" }> = ({ status }) => {
  if (status === "running") {
    return <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue animate-pulse shrink-0" />;
  }
  if (status === "complete") {
    return <span className="text-green text-[10px] shrink-0">&#10003;</span>;
  }
  return <span className="text-red text-[10px] shrink-0">&#10007;</span>;
};

// ---------------------------------------------------------------------------
// Tool-specific card renderers
// ---------------------------------------------------------------------------

const FileCard: FC<{ card: ToolCard; collapsed?: boolean }> = ({ card, collapsed }) => {
  const path = (card.toolInput?.path ?? card.detail?.path ?? "") as string;
  const isWrite = card.toolName === "file_write";
  const lang = path ? langFromPath(path) : "";

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px]",
      "bg-surface0/30 border-surface0",
      collapsed && "py-0.5",
    )}>
      <StatusDot status={card.status} />
      <span className="text-muted-foreground shrink-0">{isWrite ? "Write" : "Read"}</span>
      <code className="text-foreground font-mono text-[10px] truncate flex-1">
        {truncatePath(path)}
      </code>
      {lang && (
        <span className="px-1 py-0 rounded text-[9px] bg-blue/10 text-blue font-semibold shrink-0">
          {lang}
        </span>
      )}
      {card.completedAt && (
        <span className="text-muted-foreground text-[9px] shrink-0">
          {elapsed(card.timestamp, card.completedAt)}
        </span>
      )}
    </div>
  );
};

const ShellCard: FC<{ card: ToolCard; collapsed?: boolean }> = ({ card, collapsed }) => {
  const command = (card.toolInput?.command ?? card.detail?.command ?? "") as string;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px]",
      "bg-crust border-surface0",
      collapsed && "py-0.5",
    )}>
      <StatusDot status={card.status} />
      <span className="text-green shrink-0 font-mono text-[10px]">$</span>
      <code className="text-foreground font-mono text-[10px] truncate flex-1">
        {truncateCommand(command)}
      </code>
      {card.completedAt && (
        <span className="text-muted-foreground text-[9px] shrink-0">
          {elapsed(card.timestamp, card.completedAt)}
        </span>
      )}
    </div>
  );
};

const DirCard: FC<{ card: ToolCard; collapsed?: boolean }> = ({ card, collapsed }) => {
  const path = (card.toolInput?.path ?? card.detail?.path ?? "") as string;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px]",
      "bg-surface0/30 border-surface0",
      collapsed && "py-0.5",
    )}>
      <StatusDot status={card.status} />
      <span className="text-muted-foreground shrink-0">List</span>
      <code className="text-foreground font-mono text-[10px] truncate flex-1">
        {truncatePath(path)}
      </code>
      {card.completedAt && (
        <span className="text-muted-foreground text-[9px] shrink-0">
          {elapsed(card.timestamp, card.completedAt)}
        </span>
      )}
    </div>
  );
};

const SearchCard: FC<{ card: ToolCard; collapsed?: boolean }> = ({ card, collapsed }) => {
  const query = (card.toolInput?.query ?? card.toolInput?.pattern ?? card.detail?.query ?? card.detail?.pattern ?? "") as string;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px]",
      "bg-surface0/30 border-surface0",
      collapsed && "py-0.5",
    )}>
      <StatusDot status={card.status} />
      <span className="text-muted-foreground shrink-0">Search</span>
      <code className="text-yellow font-mono text-[10px] truncate flex-1">
        {truncateCommand(String(query), 50)}
      </code>
      {card.completedAt && (
        <span className="text-muted-foreground text-[9px] shrink-0">
          {elapsed(card.timestamp, card.completedAt)}
        </span>
      )}
    </div>
  );
};

const GitCard: FC<{ card: ToolCard; collapsed?: boolean }> = ({ card, collapsed }) => {
  const action = (card.toolInput?.action ?? card.detail?.action ?? card.toolName.replace("git_", "")) as string;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px]",
      "bg-peach/5 border-peach/20",
      collapsed && "py-0.5",
    )}>
      <StatusDot status={card.status} />
      <span className="text-peach font-semibold shrink-0">Git</span>
      <span className="text-foreground text-[10px] truncate flex-1">{action}</span>
      {card.completedAt && (
        <span className="text-muted-foreground text-[9px] shrink-0">
          {elapsed(card.timestamp, card.completedAt)}
        </span>
      )}
    </div>
  );
};

const PlanCard: FC<{ card: ToolCard; collapsed?: boolean }> = ({ card, collapsed }) => {
  const title = (card.toolInput?.title ?? card.detail?.title ?? "") as string;
  const isUpdate = card.toolName === "update_plan";

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px]",
      "bg-mauve/5 border-mauve/20",
      collapsed && "py-0.5",
    )}>
      <StatusDot status={card.status} />
      <span className="text-mauve font-semibold shrink-0">{isUpdate ? "Update Plan" : "Plan"}</span>
      {title && <span className="text-foreground text-[10px] truncate flex-1">{truncateCommand(String(title), 40)}</span>}
      {card.completedAt && (
        <span className="text-muted-foreground text-[9px] shrink-0">
          {elapsed(card.timestamp, card.completedAt)}
        </span>
      )}
    </div>
  );
};

const ProjectCard: FC<{ card: ToolCard; collapsed?: boolean }> = ({ card, collapsed }) => {
  const action = (card.toolInput?.action ?? card.detail?.action ?? "") as string;
  const name = (card.toolInput?.name ?? card.detail?.name ?? "") as string;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px]",
      "bg-teal/5 border-teal/20",
      collapsed && "py-0.5",
    )}>
      <StatusDot status={card.status} />
      <span className="text-teal font-semibold shrink-0">Project</span>
      <span className="text-foreground text-[10px] truncate flex-1">
        {action}{name ? `: ${name}` : ""}
      </span>
      {card.completedAt && (
        <span className="text-muted-foreground text-[9px] shrink-0">
          {elapsed(card.timestamp, card.completedAt)}
        </span>
      )}
    </div>
  );
};

const GenericCard: FC<{ card: ToolCard; collapsed?: boolean }> = ({ card, collapsed }) => {
  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px]",
      "bg-surface0/30 border-surface0",
      collapsed && "py-0.5",
    )}>
      <StatusDot status={card.status} />
      <span className="text-muted-foreground shrink-0">{card.toolName}</span>
      {card.summary && card.status !== "running" && (
        <span className="text-foreground text-[10px] truncate flex-1">{card.summary}</span>
      )}
      {card.completedAt && (
        <span className="text-muted-foreground text-[9px] shrink-0">
          {elapsed(card.timestamp, card.completedAt)}
        </span>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card router
// ---------------------------------------------------------------------------

export const SingleToolCard: FC<{ card: ToolCard; collapsed?: boolean }> = ({ card, collapsed }) => {
  switch (card.toolName) {
    case "file_read":
    case "file_write":
      return <FileCard card={card} collapsed={collapsed} />;
    case "shell_exec":
      return <ShellCard card={card} collapsed={collapsed} />;
    case "dir_list":
      return <DirCard card={card} collapsed={collapsed} />;
    case "grep_search":
    case "search_prime":
      return <SearchCard card={card} collapsed={collapsed} />;
    case "git_status":
    case "git_diff":
    case "git_add":
    case "git_commit":
    case "git_branch":
      return <GitCard card={card} collapsed={collapsed} />;
    case "create_plan":
    case "update_plan":
      return <PlanCard card={card} collapsed={collapsed} />;
    case "manage_project":
      return <ProjectCard card={card} collapsed={collapsed} />;
    default:
      return <GenericCard card={card} collapsed={collapsed} />;
  }
};

// ---------------------------------------------------------------------------
// ToolCards — renders a list of frozen cards (for message history)
// ---------------------------------------------------------------------------

export const ToolCards: FC<{ cards: ToolCard[]; collapsed?: boolean }> = ({ cards, collapsed }) => {
  // Dedupe by id — keep only last version of each card
  const unique = useMemo(() => {
    const map = new Map<string, ToolCard>();
    for (const c of cards) map.set(c.id, c);
    return Array.from(map.values());
  }, [cards]);

  if (unique.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 mb-1">
      {unique.map((card) => (
        <SingleToolCard key={card.id} card={card} collapsed={collapsed} />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// LiveToolCards — renders running cards with "Thinking..." fallback
// ---------------------------------------------------------------------------

export const LiveToolCards: FC<{ cards: ToolCard[]; progressText?: string }> = ({ cards, progressText }) => {
  const hasRunning = cards.some((c) => c.status === "running");

  return (
    <div className="flex flex-col gap-0.5">
      {cards.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {cards.map((card) => (
            <SingleToolCard key={card.id} card={card} />
          ))}
        </div>
      )}
      {progressText && (
        <div className="px-2 py-1 text-[11px] text-muted-foreground italic truncate">
          {progressText}
        </div>
      )}
      {!hasRunning && !progressText && (
        <div className="flex items-center gap-2 px-2 py-1 text-muted-foreground text-[11px]">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" />
          <span>Thinking...</span>
        </div>
      )}
    </div>
  );
};
