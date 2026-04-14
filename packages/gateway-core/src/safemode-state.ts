/**
 * Safemode state — in-memory singleton tracking whether the gateway booted
 * after a detected crash (missing shutdown marker).
 *
 * In safemode:
 *   - Dashboard forces all routes to /admin (client-side guard)
 *   - Mutation API endpoints return 503 { error: "safemode_active" }
 *   - Admin APIs are fully served
 *   - Auto-starts (HF models, project containers) are skipped
 *   - Investigator runs async and writes an incident report
 *
 * Exit via the admin API, the CLI (`agi safemode exit`), or automatically
 * after the investigator classifies the incident as auto-recoverable and the
 * user approves.
 */

import { EventEmitter } from "node:events";

export interface SafemodeSnapshot {
  active: boolean;
  reason: "crash_detected" | "manual" | null;
  since: string | null;
  /** Absolute path to the incident report markdown, if the investigator finished. */
  reportPath: string | null;
  /** Investigator status. */
  investigation:
    | { status: "pending" }
    | { status: "running"; startedAt: string }
    | { status: "complete"; finishedAt: string; autoRecoverable: boolean }
    | { status: "failed"; finishedAt: string; error: string };
}

type SafemodeEvents = "change";

class SafemodeState {
  private active = false;
  private reason: SafemodeSnapshot["reason"] = null;
  private since: string | null = null;
  private reportPath: string | null = null;
  private investigation: SafemodeSnapshot["investigation"] = { status: "pending" };
  private readonly emitter = new EventEmitter();

  snapshot(): SafemodeSnapshot {
    return {
      active: this.active,
      reason: this.reason,
      since: this.since,
      reportPath: this.reportPath,
      investigation: this.investigation,
    };
  }

  enter(reason: Exclude<SafemodeSnapshot["reason"], null>): void {
    this.active = true;
    this.reason = reason;
    this.since = new Date().toISOString();
    this.investigation = { status: "pending" };
    this.emitChange();
  }

  exit(): void {
    this.active = false;
    this.reason = null;
    this.since = null;
    this.reportPath = null;
    this.investigation = { status: "pending" };
    this.emitChange();
  }

  setInvestigating(): void {
    this.investigation = { status: "running", startedAt: new Date().toISOString() };
    this.emitChange();
  }

  setInvestigationComplete(reportPath: string, autoRecoverable: boolean): void {
    this.reportPath = reportPath;
    this.investigation = {
      status: "complete",
      finishedAt: new Date().toISOString(),
      autoRecoverable,
    };
    this.emitChange();
  }

  setInvestigationFailed(error: string): void {
    this.investigation = {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error,
    };
    this.emitChange();
  }

  isActive(): boolean {
    return this.active;
  }

  on(event: SafemodeEvents, listener: (snap: SafemodeSnapshot) => void): void {
    this.emitter.on(event, listener);
  }

  off(event: SafemodeEvents, listener: (snap: SafemodeSnapshot) => void): void {
    this.emitter.off(event, listener);
  }

  private emitChange(): void {
    this.emitter.emit("change", this.snapshot());
  }
}

// Module-level singleton — gateway is a single-tenant process so this is safe.
export const safemodeState = new SafemodeState();
