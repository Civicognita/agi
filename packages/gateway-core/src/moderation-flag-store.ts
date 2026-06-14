/**
 * ModerationFlagStore — in-memory ring buffer for AI-raised moderation flags.
 *
 * Stores up to MAX_FLAGS flags in memory. Each flag carries a severity level,
 * optional AI scoring (toxicity, escalation), AI reasoning, and a recommended
 * action. Flags can be actioned (warn/dismiss/escalate/ban) by moderators.
 *
 * Design: flags are ephemeral operational data — the queue is cleared on
 * restart. A Postgres-backed store can replace this when persistence is needed.
 */

import { ulid } from "ulid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlagSeverity = "critical" | "high" | "medium" | "low";
export type FlagStatus = "open" | "actioned" | "dismissed";
export type FlagActionKind =
  | "dismiss"
  | "warn"
  | "timeout"
  | "ban"
  | "escalate"
  | "redact"
  | "monitor"
  | "mark_constructive";

export interface FlagScores {
  toxicity?: number;
  sarcasm?: number;
  escalation?: number;
}

export interface FlagAction {
  kind: FlagActionKind;
  moderatorId: string;
  at: string;
  note?: string;
}

export interface ModerationFlag {
  id: string;
  channel: string;
  userId: string;
  displayName: string | null;
  messagePreview: string;
  severity: FlagSeverity;
  status: FlagStatus;
  reason: string;
  recommendedAction?: string;
  scores?: FlagScores;
  priorFlagCount: number;
  flaggedAt: string;
  action?: FlagAction;
  entityId?: string | null;
}

export type ModerationFlagParams = Omit<ModerationFlag, "id" | "flaggedAt" | "status" | "action">;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const MAX_FLAGS = 500;

export class ModerationFlagStore {
  private readonly flags: ModerationFlag[] = [];

  capture(params: ModerationFlagParams): ModerationFlag {
    const flag: ModerationFlag = {
      id: ulid(),
      flaggedAt: new Date().toISOString(),
      status: "open",
      ...params,
    };

    this.flags.push(flag);
    if (this.flags.length > MAX_FLAGS) {
      this.flags.splice(0, this.flags.length - MAX_FLAGS);
    }

    return flag;
  }

  list(opts?: {
    status?: FlagStatus;
    severity?: FlagSeverity;
    channel?: string;
    limit?: number;
  }): ModerationFlag[] {
    const limit = opts?.limit ?? 100;
    let result = [...this.flags].reverse(); // newest first

    if (opts?.status !== undefined) result = result.filter((f) => f.status === opts.status);
    if (opts?.severity !== undefined) result = result.filter((f) => f.severity === opts.severity);
    if (opts?.channel !== undefined) result = result.filter((f) => f.channel === opts.channel);

    return result.slice(0, limit);
  }

  count(opts?: { status?: FlagStatus; severity?: FlagSeverity; channel?: string }): number {
    let result = this.flags;
    if (opts?.status !== undefined) result = result.filter((f) => f.status === opts.status);
    if (opts?.severity !== undefined) result = result.filter((f) => f.severity === opts.severity);
    if (opts?.channel !== undefined) result = result.filter((f) => f.channel === opts.channel);
    return result.length;
  }

  action(id: string, action: FlagAction): ModerationFlag | null {
    const flag = this.flags.find((f) => f.id === id);
    if (flag === undefined) return null;

    flag.action = action;
    flag.status = action.kind === "dismiss" || action.kind === "mark_constructive" ? "dismissed" : "actioned";
    return flag;
  }

  getById(id: string): ModerationFlag | null {
    return this.flags.find((f) => f.id === id) ?? null;
  }
}
