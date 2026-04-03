import { EventEmitter } from "node:events";

import type { GatewayState } from "./types.js";

// ---------------------------------------------------------------------------
// State transition map — mirrors BAIF operational states from CLAUDE.md
// ---------------------------------------------------------------------------

const TRANSITIONS: Map<GatewayState, Set<GatewayState>> = new Map([
  ["ONLINE", new Set<GatewayState>(["LIMBO", "UNKNOWN"])],
  ["LIMBO", new Set<GatewayState>(["ONLINE", "OFFLINE"])],
  ["OFFLINE", new Set<GatewayState>(["ONLINE"])],
  ["UNKNOWN", new Set<GatewayState>(["ONLINE", "LIMBO", "OFFLINE"])],
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What operations are permitted in a given gateway state. */
export interface StateCapabilities {
  /** Can make remote calls (Cognee, external APIs). */
  remoteOps: boolean;
  /** Tynn MCP server is reachable. */
  tynn: boolean;
  /** Local memory store is readable/writable. */
  memory: boolean;
  /** Deletions are permitted (ONLINE only, after sync). */
  deletions: boolean;
}

/** A single entry in the state transition history. */
export interface StateTransition {
  from: GatewayState;
  to: GatewayState;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// State capabilities table
// ---------------------------------------------------------------------------

const CAPABILITIES: Record<GatewayState, StateCapabilities> = {
  ONLINE: { remoteOps: true, tynn: true, memory: true, deletions: true },
  LIMBO: { remoteOps: false, tynn: true, memory: true, deletions: false },
  OFFLINE: { remoteOps: false, tynn: false, memory: true, deletions: false },
  UNKNOWN: { remoteOps: false, tynn: false, memory: false, deletions: false },
};

const HISTORY_MAX = 100;

// ---------------------------------------------------------------------------
// GatewayStateMachine
// ---------------------------------------------------------------------------

/**
 * State machine for the Aionima gateway, mirroring BAIF operational states.
 *
 * Emits `"state_change"` whenever a successful transition occurs.
 *
 * @example
 * const sm = new GatewayStateMachine("UNKNOWN");
 * sm.on("state_change", ({ from, to }) => console.log(`${from} -> ${to}`));
 * sm.transition("ONLINE"); // true
 * sm.isAllowed("tynn");    // true
 */
export class GatewayStateMachine extends EventEmitter {
  private current: GatewayState;
  private readonly history: StateTransition[];

  constructor(initialState: GatewayState = "UNKNOWN") {
    super();
    this.current = initialState;
    this.history = [];
  }

  // ---------------------------------------------------------------------------
  // State accessors
  // ---------------------------------------------------------------------------

  /** Return the current gateway state. */
  getState(): GatewayState {
    return this.current;
  }

  // ---------------------------------------------------------------------------
  // Transition logic
  // ---------------------------------------------------------------------------

  /**
   * Check whether a transition from the current state to `to` is valid
   * according to the BAIF state transition rules.
   */
  canTransition(to: GatewayState): boolean {
    const allowed = TRANSITIONS.get(this.current);
    return allowed !== undefined && allowed.has(to);
  }

  /**
   * Attempt a state transition.
   *
   * @returns `true` if the transition was accepted and applied; `false` if the
   *   transition is not permitted from the current state.
   *
   * Emits `"state_change"` with `{ from, to, timestamp }` on success.
   */
  transition(to: GatewayState): boolean {
    if (!this.canTransition(to)) {
      return false;
    }

    const entry: StateTransition = {
      from: this.current,
      to,
      timestamp: new Date().toISOString(),
    };

    this.current = to;

    // Bounded history — drop oldest when at capacity
    if (this.history.length >= HISTORY_MAX) {
      this.history.shift();
    }
    this.history.push(entry);

    this.emit("state_change", entry);

    return true;
  }

  // ---------------------------------------------------------------------------
  // Capabilities
  // ---------------------------------------------------------------------------

  /** Return the full capability set for the current state. */
  getCapabilities(): StateCapabilities {
    return CAPABILITIES[this.current];
  }

  /**
   * Check whether a specific operation is permitted in the current state.
   *
   * @param op - One of `"remoteOps"`, `"tynn"`, `"memory"`, or `"deletions"`.
   */
  isAllowed(op: keyof StateCapabilities): boolean {
    return CAPABILITIES[this.current][op];
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /**
   * Return a shallow copy of the transition history, ordered oldest-first.
   * At most 100 entries are retained.
   */
  getHistory(): StateTransition[] {
    return [...this.history];
  }
}
