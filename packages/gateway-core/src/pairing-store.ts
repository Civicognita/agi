/**
 * PairingStore — manages pairing codes for DM access grants.
 *
 * Modeled on OpenClaw's pairing-store.ts. When an unknown user messages
 * the bot, a pairing code is generated and the owner must approve it
 * before the user gains access.
 *
 * Approved users are persisted to a JSON file so they survive restarts.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PairingRequest {
  code: string;
  channel: string;
  channelUserId: string;
  displayName: string;
  createdAt: string;
  expiresAt: string;
}

export interface PairedUser {
  channel: string;
  channelUserId: string;
  displayName: string;
  pairedAt: string;
}

export interface PairingStoreConfig {
  /** Path to persist approved users. Default: "./data/paired.json" */
  persistPath?: string;
  /** Pairing code TTL in ms. Default: 1 hour. */
  codeTtlMs?: number;
  /** Max pending pairing requests per channel. Default: 10. */
  maxPendingPerChannel?: number;
  /** Optional logger instance. */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

// Exclude ambiguous characters: 0, O, 1, I
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// ---------------------------------------------------------------------------
// PairingStore
// ---------------------------------------------------------------------------

export class PairingStore {
  private readonly persistPath: string;
  private readonly codeTtlMs: number;
  private readonly maxPendingPerChannel: number;
  private readonly log: ComponentLogger;

  /** Pending pairing requests keyed by code. */
  private readonly pending = new Map<string, PairingRequest>();

  /** Approved users keyed by "channel:channelUserId". */
  private readonly approved = new Map<string, PairedUser>();

  constructor(config?: PairingStoreConfig) {
    this.persistPath = config?.persistPath ?? "./data/paired.json";
    this.codeTtlMs = config?.codeTtlMs ?? 3_600_000; // 1 hour
    this.maxPendingPerChannel = config?.maxPendingPerChannel ?? 10;
    this.log = createComponentLogger(config?.logger, "pairing");

    this.loadApproved();
  }

  // -------------------------------------------------------------------------
  // Pending requests
  // -------------------------------------------------------------------------

  /**
   * Generate a pairing code for an unknown user.
   * Returns the code, or null if max pending for that channel is reached.
   */
  createRequest(
    channel: string,
    channelUserId: string,
    displayName: string,
  ): PairingRequest | null {
    // Check if already approved
    if (this.isApproved(channel, channelUserId)) return null;

    // Check if already has a pending request
    for (const req of this.pending.values()) {
      if (req.channel === channel && req.channelUserId === channelUserId) {
        // Return existing pending request
        return req;
      }
    }

    // Check max pending per channel
    const channelPending = [...this.pending.values()].filter(
      (r) => r.channel === channel,
    );
    if (channelPending.length >= this.maxPendingPerChannel) {
      // Purge expired before failing
      this.purgeExpired();
      const afterPurge = [...this.pending.values()].filter(
        (r) => r.channel === channel,
      );
      if (afterPurge.length >= this.maxPendingPerChannel) return null;
    }

    const now = new Date();
    const code = generateCode();
    const request: PairingRequest = {
      code,
      channel,
      channelUserId,
      displayName,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.codeTtlMs).toISOString(),
    };

    this.pending.set(code, request);
    return request;
  }

  /** Get a pending request by code. Returns null if not found or expired. */
  getRequest(code: string): PairingRequest | null {
    const req = this.pending.get(code.toUpperCase());
    if (req === undefined) return null;
    if (new Date(req.expiresAt) < new Date()) {
      this.pending.delete(code.toUpperCase());
      return null;
    }
    return req;
  }

  /** List all non-expired pending requests. */
  getPendingRequests(): PairingRequest[] {
    this.purgeExpired();
    return [...this.pending.values()];
  }

  // -------------------------------------------------------------------------
  // Approval / rejection
  // -------------------------------------------------------------------------

  /**
   * Approve a pairing code. Moves the user to the approved list
   * and persists to disk.
   * Returns the approved user, or null if code not found / expired.
   */
  approve(code: string): PairedUser | null {
    const req = this.getRequest(code);
    if (req === null) return null;

    const paired: PairedUser = {
      channel: req.channel,
      channelUserId: req.channelUserId,
      displayName: req.displayName,
      pairedAt: new Date().toISOString(),
    };

    const key = `${req.channel}:${req.channelUserId}`;
    this.approved.set(key, paired);
    this.pending.delete(code.toUpperCase());
    this.saveApproved();

    return paired;
  }

  /**
   * Reject a pairing code. Removes from pending.
   * Returns true if the code was found and removed.
   */
  reject(code: string): boolean {
    const upper = code.toUpperCase();
    return this.pending.delete(upper);
  }

  /**
   * Revoke a previously approved user.
   * Returns true if the user was found and revoked.
   */
  revoke(channel: string, channelUserId: string): boolean {
    const key = `${channel}:${channelUserId}`;
    const had = this.approved.delete(key);
    if (had) this.saveApproved();
    return had;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Check if a user is approved (paired). */
  isApproved(channel: string, channelUserId: string): boolean {
    return this.approved.has(`${channel}:${channelUserId}`);
  }

  /** List all approved (paired) users. */
  getApprovedUsers(): PairedUser[] {
    return [...this.approved.values()];
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private loadApproved(): void {
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as PairedUser[];
      for (const user of data) {
        const key = `${user.channel}:${user.channelUserId}`;
        this.approved.set(key, user);
      }
    } catch {
      // File doesn't exist yet — start empty
    }
  }

  private saveApproved(): void {
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(
        this.persistPath,
        JSON.stringify([...this.approved.values()], null, 2),
        "utf-8",
      );
    } catch (err) {
      this.log.error(
        `Failed to save approved users: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private purgeExpired(): void {
    const now = new Date();
    for (const [code, req] of this.pending) {
      if (new Date(req.expiresAt) < now) {
        this.pending.delete(code);
      }
    }
  }
}
