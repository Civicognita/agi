/**
 * PendingApprovalStore — channel-scoped pending-entity approvals.
 *
 * **CHN-E (s166) slice 1 — 2026-05-14.** When an unknown user posts in
 * a channel room that's bound to a project (see ChannelEventDispatcher
 * + the rooms[] binding model), instead of silently dropping the
 * message we capture a pending-approval record. The owner promotes via
 * `/identity/pending` (UI lands in slice 3+) which either approves the
 * user (creating a verified entity tied to the bound project) or
 * rejects (discards + flags the source for future filtering).
 *
 * Modeled on PairingStore but scoped per-(channelId, roomId) instead of
 * per-channel: a single user can have separate pending approvals for
 * different rooms (e.g. Alice in #general and Alice in #bugs each get
 * their own approval). The {channelId, channelUserId, roomId} triple is
 * the dedup key.
 *
 * In-memory in this slice. Future slice persists to a JSON file at
 * `~/.agi/pending-approvals.json` for restart survival; same pattern
 * as PairingStore's `paired.json`.
 *
 * Reference: agi/docs/agents/channel-plugin-redesign.md §8 (Cage +
 * entity flow); story s166 acceptance criteria.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One pending approval record awaiting owner action. */
export interface PendingApproval {
  /** Stable id — channel + room + channel-user. */
  id: string;
  channelId: string;
  /** Channel-scoped room id (matches the picker's encoding). */
  roomId: string;
  /** Channel-scoped user id (Discord member id, Telegram username, etc.). */
  channelUserId: string;
  /** Display name we caught at first-message time. */
  displayName: string;
  /** Project the room is bound to. Captured at creation so owner sees context. */
  projectPath: string;
  /** First-message preview (first 200 chars). Helps owner decide. */
  firstMessagePreview: string;
  /** ISO 8601 timestamp when the pending record was created. */
  createdAt: string;
}

/** Decision recorded when owner acts on the pending approval. */
export interface PendingApprovalDecision {
  status: "approved" | "rejected";
  /** ISO 8601 timestamp of the decision. */
  decidedAt: string;
}

export interface PendingApprovalStoreConfig {
  /**
   * Path to persist approvals + decisions across gateway restarts.
   * When unset, the store is in-memory only (loses state on restart).
   * Convention path: `~/.agi/pending-approvals.json` (mirrors paired.json).
   * CHN-E (s166) slice 7 — 2026-05-14.
   */
  persistPath?: string;
  /** Optional logger instance. */
  logger?: Logger;
}

/** On-disk shape — two arrays. */
interface PersistShape {
  approvals: PendingApproval[];
  decisions: Array<[string, PendingApprovalDecision]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the stable id for a (channelId, roomId, channelUserId) triple.
 * Same triple always produces the same id, so creating twice is idempotent.
 */
export function pendingApprovalId(
  channelId: string,
  roomId: string,
  channelUserId: string,
): string {
  return `${channelId}::${roomId}::${channelUserId}`;
}

// ---------------------------------------------------------------------------
// PendingApprovalStore
// ---------------------------------------------------------------------------

export class PendingApprovalStore {
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly decisions = new Map<string, PendingApprovalDecision>();
  private readonly persistPath: string | null;
  private readonly log: ComponentLogger;

  constructor(config: PendingApprovalStoreConfig = {}) {
    this.log = createComponentLogger(config.logger, "pending-approval");
    this.persistPath = config.persistPath ?? null;
    if (this.persistPath !== null) {
      this.load();
    }
  }

  // -------------------------------------------------------------------------
  // Persistence (CHN-E s166 slice 7)
  // -------------------------------------------------------------------------

  /** Read approvals + decisions from disk into memory. Silent on missing file. */
  private load(): void {
    if (this.persistPath === null) return;
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as PersistShape;
      if (Array.isArray(data.approvals)) {
        for (const a of data.approvals) {
          this.approvals.set(a.id, a);
        }
      }
      if (Array.isArray(data.decisions)) {
        for (const [id, decision] of data.decisions) {
          this.decisions.set(id, decision);
        }
      }
      this.log.info(
        `loaded ${String(this.approvals.size)} pending + ${String(this.decisions.size)} decisions from ${this.persistPath}`,
      );
    } catch (err) {
      this.log.warn(
        `failed to load pending-approvals from ${this.persistPath} (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Write current state to disk. Idempotent; safe to call after every mutation. */
  private save(): void {
    if (this.persistPath === null) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const data: PersistShape = {
        approvals: [...this.approvals.values()],
        decisions: [...this.decisions.entries()],
      };
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      this.log.error(
        `failed to save pending-approvals to ${String(this.persistPath)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Capture a new pending approval. Idempotent: re-calling with the
   * same triple updates the displayName + firstMessagePreview but keeps
   * the original createdAt + id. Returns the (possibly-updated) record.
   */
  capture(input: {
    channelId: string;
    roomId: string;
    channelUserId: string;
    displayName: string;
    projectPath: string;
    firstMessagePreview: string;
  }): PendingApproval {
    const id = pendingApprovalId(input.channelId, input.roomId, input.channelUserId);
    const existing = this.approvals.get(id);
    if (existing !== undefined) {
      // Refresh the display name + preview but keep the original id + createdAt
      const refreshed: PendingApproval = {
        ...existing,
        displayName: input.displayName,
        firstMessagePreview: input.firstMessagePreview,
      };
      this.approvals.set(id, refreshed);
      this.save();
      return refreshed;
    }
    const fresh: PendingApproval = {
      id,
      channelId: input.channelId,
      roomId: input.roomId,
      channelUserId: input.channelUserId,
      displayName: input.displayName,
      projectPath: input.projectPath,
      firstMessagePreview: input.firstMessagePreview.slice(0, 200),
      createdAt: new Date().toISOString(),
    };
    this.approvals.set(id, fresh);
    this.log.info(`pending approval captured: ${id} (${input.displayName}, ${input.projectPath})`);
    this.save();
    return fresh;
  }

  /** Return all pending approvals (sorted oldest-first). */
  list(): PendingApproval[] {
    return [...this.approvals.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Return pending approvals for one project only. */
  listForProject(projectPath: string): PendingApproval[] {
    return this.list().filter((p) => p.projectPath === projectPath);
  }

  /** Get one pending approval by id; returns null when absent. */
  get(id: string): PendingApproval | null {
    return this.approvals.get(id) ?? null;
  }

  /**
   * Mark the approval as approved and remove it from the pending queue.
   * Returns the resolved record + decision. Throws when the id isn't found.
   */
  approve(id: string): { approval: PendingApproval; decision: PendingApprovalDecision } {
    const approval = this.approvals.get(id);
    if (approval === undefined) {
      throw new Error(`Pending approval not found: ${id}`);
    }
    const decision: PendingApprovalDecision = { status: "approved", decidedAt: new Date().toISOString() };
    this.approvals.delete(id);
    this.decisions.set(id, decision);
    this.log.info(`pending approval APPROVED: ${id}`);
    this.save();
    return { approval, decision };
  }

  /**
   * Mark the approval as rejected and remove it from the pending queue.
   * Returns the rejected record + decision. Throws when the id isn't found.
   */
  reject(id: string): { approval: PendingApproval; decision: PendingApprovalDecision } {
    const approval = this.approvals.get(id);
    if (approval === undefined) {
      throw new Error(`Pending approval not found: ${id}`);
    }
    const decision: PendingApprovalDecision = { status: "rejected", decidedAt: new Date().toISOString() };
    this.approvals.delete(id);
    this.decisions.set(id, decision);
    this.log.info(`pending approval REJECTED: ${id}`);
    this.save();
    return { approval, decision };
  }

  /**
   * Read the last decision recorded for a triple. Returns null when no
   * decision has been made (the approval is either still pending or
   * never existed). Useful for the dispatcher to short-circuit:
   * "rejected" senders get their messages dropped at the source
   * without re-capturing a pending record.
   */
  decisionFor(channelId: string, roomId: string, channelUserId: string): PendingApprovalDecision | null {
    const id = pendingApprovalId(channelId, roomId, channelUserId);
    return this.decisions.get(id) ?? null;
  }

  /** Test-only: clear all state (in-memory + persisted, if configured). */
  reset(): void {
    this.approvals.clear();
    this.decisions.clear();
    this.save();
  }
}
