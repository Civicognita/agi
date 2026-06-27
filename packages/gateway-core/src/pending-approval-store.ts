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
  /** Collected via DM registration flow (s194). Present when user completed registration steps. */
  registrationData?: {
    name?: string;
    email?: string;
    birthdate?: string;
    pronouns?: string;
    discordHandle?: string;
  };
  /** Project paths owner assigned at approval time (s195). */
  assignedProjectPaths?: string[];
}

/** Decision recorded when owner acts on the pending approval.
 *
 * Wave 1 (s228): the decision now retains a snapshot of WHO the person was,
 * so approved/rejected people stay listable + manageable after the pending
 * record is removed. (Previously only status + decidedAt were kept, so the
 * dashboard had "no way of seeing who has been approved.") The person fields
 * are optional for backward-compat with pre-Wave-1 persisted decisions. */
export interface PendingApprovalDecision {
  status: "approved" | "rejected";
  /** ISO 8601 timestamp of the decision. */
  decidedAt: string;
  /** Channel the person belongs to (e.g. "discord"). */
  channelId?: string;
  /** Channel-scoped user id. Together with channelId this is the person key. */
  channelUserId?: string;
  /** Display name captured at decision time. */
  displayName?: string;
  /** The room/project context the decision was made in. */
  projectPath?: string;
  /** Projects the owner granted at/after approval (editable via manage UI). */
  assignedProjectPaths?: string[];
  /** Registration data the person supplied, if any. */
  registrationData?: PendingApproval["registrationData"];
}

/** Stable per-person key (a person spans multiple rooms). */
export function personKey(channelId: string, channelUserId: string): string {
  return `${channelId}::${channelUserId}`;
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
    /** Project that binds this room. Empty string when the room is not yet bound to any project. */
    projectPath?: string;
    firstMessagePreview: string;
    /** Collected via DM registration flow (s194). */
    registrationData?: PendingApproval["registrationData"];
  }): PendingApproval {
    const id = pendingApprovalId(input.channelId, input.roomId, input.channelUserId);
    const existing = this.approvals.get(id);
    if (existing !== undefined) {
      // Refresh display name + preview; merge registration data if now provided
      const refreshed: PendingApproval = {
        ...existing,
        displayName: input.displayName,
        firstMessagePreview: input.firstMessagePreview,
        ...(input.registrationData !== undefined ? { registrationData: input.registrationData } : {}),
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
      projectPath: input.projectPath ?? "",
      firstMessagePreview: input.firstMessagePreview.slice(0, 200),
      createdAt: new Date().toISOString(),
      ...(input.registrationData !== undefined ? { registrationData: input.registrationData } : {}),
    };
    this.approvals.set(id, fresh);
    this.log.info(`pending approval captured: ${id} (${input.displayName}, ${input.projectPath ?? "(unbound)"})`);
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

  /** Find the first pending approval by channel + channel-user (any room). Useful for gate logic. */
  getByChannelUser(channelId: string, channelUserId: string): PendingApproval | null {
    for (const approval of this.approvals.values()) {
      if (approval.channelId === channelId && approval.channelUserId === channelUserId) {
        return approval;
      }
    }
    return null;
  }

  /**
   * Every pending-record id for the SAME person (channelId, channelUserId) —
   * including the passed id. A single human who posted in N rooms has N records
   * (the dedup key is per-room); approving/rejecting acts on the PERSON, so we
   * cascade across all their rooms. The owner sees one card per person
   * (grouped in the UI), and one click resolves the whole person.
   */
  private siblingIdsForPerson(channelId: string, channelUserId: string): string[] {
    const out: string[] = [];
    for (const a of this.approvals.values()) {
      if (a.channelId === channelId && a.channelUserId === channelUserId) out.push(a.id);
    }
    return out;
  }

  /**
   * Approve the PERSON behind a pending record: removes ALL of that
   * (channelId, channelUserId)'s pending records across rooms and records an
   * "approved" decision for each room id. Returns the targeted record (with any
   * assigned project paths) + decision. Throws when the id isn't found.
   */
  approve(
    id: string,
    opts?: { projectPaths?: string[] },
  ): { approval: PendingApproval; decision: PendingApprovalDecision } {
    const approval = this.approvals.get(id);
    if (approval === undefined) {
      throw new Error(`Pending approval not found: ${id}`);
    }
    const finalApproval: PendingApproval = {
      ...approval,
      ...(opts?.projectPaths !== undefined && opts.projectPaths.length > 0
        ? { assignedProjectPaths: opts.projectPaths }
        : {}),
    };
    const decision: PendingApprovalDecision = {
      status: "approved",
      decidedAt: new Date().toISOString(),
      channelId: approval.channelId,
      channelUserId: approval.channelUserId,
      displayName: approval.displayName,
      projectPath: approval.projectPath,
      ...(finalApproval.assignedProjectPaths !== undefined ? { assignedProjectPaths: finalApproval.assignedProjectPaths } : {}),
      ...(approval.registrationData !== undefined ? { registrationData: approval.registrationData } : {}),
    };
    const siblingIds = this.siblingIdsForPerson(approval.channelId, approval.channelUserId);
    for (const sibId of siblingIds) {
      this.approvals.delete(sibId);
      this.decisions.set(sibId, decision);
    }
    this.log.info(`pending approval APPROVED: ${id}${siblingIds.length > 1 ? ` (+${String(siblingIds.length - 1)} sibling room(s))` : ""}`);
    this.save();
    return { approval: finalApproval, decision };
  }

  /**
   * Reject the PERSON behind a pending record: removes ALL of that
   * (channelId, channelUserId)'s pending records across rooms and records a
   * "rejected" decision for each room id (so future messages in those rooms are
   * dropped at the gate). Returns the targeted record + decision. Throws when
   * the id isn't found.
   */
  reject(id: string): { approval: PendingApproval; decision: PendingApprovalDecision } {
    const approval = this.approvals.get(id);
    if (approval === undefined) {
      throw new Error(`Pending approval not found: ${id}`);
    }
    const decision: PendingApprovalDecision = {
      status: "rejected",
      decidedAt: new Date().toISOString(),
      channelId: approval.channelId,
      channelUserId: approval.channelUserId,
      displayName: approval.displayName,
      projectPath: approval.projectPath,
      ...(approval.registrationData !== undefined ? { registrationData: approval.registrationData } : {}),
    };
    const siblingIds = this.siblingIdsForPerson(approval.channelId, approval.channelUserId);
    for (const sibId of siblingIds) {
      this.approvals.delete(sibId);
      this.decisions.set(sibId, decision);
    }
    this.log.info(`pending approval REJECTED: ${id}${siblingIds.length > 1 ? ` (+${String(siblingIds.length - 1)} sibling room(s))` : ""}`);
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

  /**
   * List decided people (approved and/or rejected), one entry per PERSON
   * (deduped across rooms, latest decision wins), newest-first. Powers the
   * identity-management view. Decisions missing the person snapshot (pre-Wave-1
   * persisted entries) are skipped — they predate the manage feature.
   */
  listDecisions(status?: "approved" | "rejected"): PendingApprovalDecision[] {
    const byPerson = new Map<string, PendingApprovalDecision>();
    for (const d of this.decisions.values()) {
      if (d.channelId === undefined || d.channelUserId === undefined) continue;
      const key = personKey(d.channelId, d.channelUserId);
      const existing = byPerson.get(key);
      if (existing === undefined || d.decidedAt > existing.decidedAt) byPerson.set(key, d);
    }
    const all = [...byPerson.values()].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
    return status !== undefined ? all.filter((d) => d.status === status) : all;
  }

  /**
   * Update the projects granted to an approved person (manage access). Applies
   * to every per-room decision for that person. Returns true if anything changed.
   */
  updateAssignedProjects(channelId: string, channelUserId: string, projectPaths: string[]): boolean {
    let changed = false;
    for (const [id, d] of this.decisions) {
      if (d.channelId === channelId && d.channelUserId === channelUserId) {
        this.decisions.set(id, { ...d, assignedProjectPaths: projectPaths });
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }

  /**
   * Set a person's assigned projects, creating a synthetic "approved" decision
   * when none exists. Approved people are now sourced from the entity store, so
   * many won't have a decision-log entry — this lets the owner assign projects
   * to them anyway (the decision log is the project-assignment side-store).
   * Always returns true (the upsert always succeeds).
   */
  upsertAssignedProjects(
    channelId: string,
    channelUserId: string,
    displayName: string,
    projectPaths: string[],
  ): boolean {
    if (this.updateAssignedProjects(channelId, channelUserId, projectPaths)) return true;
    // No existing decision — synthesize one keyed person-level (no room).
    const synthId = `${channelId}::*::${channelUserId}`;
    this.decisions.set(synthId, {
      status: "approved",
      decidedAt: new Date().toISOString(),
      channelId,
      channelUserId,
      displayName,
      projectPath: "",
      assignedProjectPaths: projectPaths,
    });
    this.save();
    return true;
  }

  /**
   * Remove ALL decisions for a person. Use to revoke an approval (the person
   * returns to unknown — a future message re-captures a pending record) or to
   * re-review a rejection (un-block so they can post again). Returns true if any
   * decision was removed.
   */
  clearDecision(channelId: string, channelUserId: string): boolean {
    let changed = false;
    // Deleting the current entry while iterating a Map is spec-safe.
    for (const [id, d] of this.decisions) {
      if (d.channelId === channelId && d.channelUserId === channelUserId) {
        this.decisions.delete(id);
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }

  /** Test-only: clear all state (in-memory + persisted, if configured). */
  reset(): void {
    this.approvals.clear();
    this.decisions.clear();
    this.save();
  }
}
