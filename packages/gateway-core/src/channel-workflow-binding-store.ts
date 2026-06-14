/**
 * ChannelWorkflowBindingStore — role/channel → MApp dispatch table.
 *
 * **CHN-F (s167) slice 1 — 2026-05-14.** Stores owner-declared bindings
 * of the form "messages arriving in channel C, room R, from a user with
 * role X, matching pattern Y → dispatch to MApp Z."
 *
 * The runtime resolver (slice 2) calls `match()` in the inbound-router
 * pipeline to find bindings and dispatches to the bound MApp.
 *
 * Modeled on PendingApprovalStore: in-memory map with JSON-file
 * persistence to `~/.agi/channel-workflow-bindings.json`.
 *
 * Reference: agi/docs/agents/channel-plugin-redesign.md §11 (CHN-F).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One channel → MApp workflow binding.
 *
 * All filter fields (roomId, roleId, messagePattern) are optional.
 * A binding with no filters matches every message on the given channel.
 */
export interface ChannelWorkflowBinding {
  /** Stable id (auto-assigned on add, UUID-style). */
  id: string;
  /** Channel id ("discord", "telegram", "email", "slack", etc.). */
  channelId: string;
  /** Restrict to a specific room. Undefined = any room on this channel. */
  roomId?: string;
  /** Restrict to messages from users bearing this channel-specific role id.
   *  For Discord: a role snowflake. Undefined = any role. */
  roleId?: string;
  /** ECMAScript regex pattern tested against message text.
   *  Undefined (or empty) = match all messages. */
  messagePattern?: string;
  /** MApp id to dispatch when all conditions match. */
  mappId: string;
  /** Optional human-readable label (e.g. "contributors → deploy-mapp"). */
  label?: string;
  /** ISO 8601 timestamp when this binding was created. */
  createdAt: string;
}

export interface ChannelWorkflowBindingStoreConfig {
  /**
   * Path to persist bindings across gateway restarts.
   * Convention path: `~/.agi/channel-workflow-bindings.json`.
   * When unset, the store is in-memory only.
   */
  persistPath?: string;
  /** Optional logger instance. */
  logger?: Logger;
}

// On-disk shape
interface PersistShape {
  bindings: ChannelWorkflowBinding[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a simple collision-resistant id from timestamp + random suffix. */
function generateId(): string {
  return `cwb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Test whether `text` matches a binding's messagePattern.
 * Empty / undefined pattern always matches.
 * Invalid regex patterns are treated as non-matching (logged as warn).
 */
function textMatchesPattern(text: string, pattern: string | undefined, log: ComponentLogger): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    log.warn(`invalid messagePattern regex "${pattern}" — treating as non-match`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// ChannelWorkflowBindingStore
// ---------------------------------------------------------------------------

export class ChannelWorkflowBindingStore {
  private readonly bindings = new Map<string, ChannelWorkflowBinding>();
  private readonly persistPath: string | null;
  private readonly log: ComponentLogger;

  constructor(config: ChannelWorkflowBindingStoreConfig = {}) {
    this.log = createComponentLogger(config.logger, "channel-workflow-bindings");
    this.persistPath = config.persistPath ?? null;
    if (this.persistPath !== null) {
      this.load();
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private load(): void {
    if (this.persistPath === null) return;
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as PersistShape;
      if (Array.isArray(data.bindings)) {
        for (const b of data.bindings) {
          this.bindings.set(b.id, b);
        }
      }
      this.log.info(`loaded ${String(this.bindings.size)} workflow bindings from ${this.persistPath}`);
    } catch (err) {
      this.log.warn(`failed to load workflow bindings (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private save(): void {
    if (this.persistPath === null) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const data: PersistShape = { bindings: [...this.bindings.values()] };
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      this.log.error(`failed to save workflow bindings to ${String(this.persistPath)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Add a workflow binding. Auto-assigns `id` and `createdAt`.
   * Returns the persisted binding record.
   */
  add(input: Omit<ChannelWorkflowBinding, "id" | "createdAt">): ChannelWorkflowBinding {
    const binding: ChannelWorkflowBinding = {
      ...input,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    this.bindings.set(binding.id, binding);
    this.log.info(`workflow binding added: ${binding.id} (${binding.channelId} → mapp:${binding.mappId})`);
    this.save();
    return binding;
  }

  /**
   * Remove a binding by id. Returns true when found + removed, false
   * when not found (idempotent).
   */
  remove(id: string): boolean {
    const existed = this.bindings.has(id);
    if (existed) {
      this.bindings.delete(id);
      this.log.info(`workflow binding removed: ${id}`);
      this.save();
    }
    return existed;
  }

  /** Return all bindings, optionally filtered to a single channel. */
  list(channelId?: string): ChannelWorkflowBinding[] {
    const all = [...this.bindings.values()];
    return channelId ? all.filter((b) => b.channelId === channelId) : all;
  }

  /** Get one binding by id; returns null when absent. */
  get(id: string): ChannelWorkflowBinding | null {
    return this.bindings.get(id) ?? null;
  }

  // -------------------------------------------------------------------------
  // Runtime matching
  // -------------------------------------------------------------------------

  /**
   * Return all bindings that match the given inbound message context.
   *
   * Match conditions (all must be satisfied):
   *   - binding.channelId === channelId
   *   - binding.roomId is absent OR binding.roomId === roomId
   *   - binding.roleId is absent OR roleId is in the caller-provided roles[]
   *   - binding.messagePattern is absent/empty OR regex matches messageText
   *
   * Returns bindings sorted by createdAt (oldest-first) so rule priority
   * follows definition order when the caller dispatches to multiple MApps.
   */
  match(opts: {
    channelId: string;
    roomId?: string;
    roles?: string[];
    messageText?: string;
  }): ChannelWorkflowBinding[] {
    const { channelId, roomId, roles = [], messageText = "" } = opts;
    return [...this.bindings.values()]
      .filter((b) => {
        if (b.channelId !== channelId) return false;
        if (b.roomId !== undefined && b.roomId !== roomId) return false;
        if (b.roleId !== undefined && !roles.includes(b.roleId)) return false;
        if (!textMatchesPattern(messageText, b.messagePattern, this.log)) return false;
        return true;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Test-only: clear all bindings (in-memory + persisted if configured). */
  reset(): void {
    this.bindings.clear();
    this.save();
  }
}
