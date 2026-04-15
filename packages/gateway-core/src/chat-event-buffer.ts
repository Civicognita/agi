/**
 * ChatEventBuffer — per-session ring buffer for chat:* WS events.
 *
 * Problem: when the browser's WebSocket briefly drops mid-run (flaky network,
 * laptop sleep, tab suspension), events emitted by the still-running agent go
 * to the dead connection and are lost. Often the missing event is the terminal
 * `chat:response`, so the client waits forever for a response the server
 * already "delivered" into the void.
 *
 * Solution: the server records every chat:* event it sends to this buffer,
 * keyed by sessionId. On reconnect the client sends `chat:resume` with its
 * last-seen seq number; the server replays everything newer.
 *
 * Pure module — no I/O, no WS dependency — so it's easy to unit test.
 */

export interface BufferedEvent {
  seq: number;
  type: string;
  payload: unknown;
  ts: number;
}

export interface ReplayResult {
  /** Events to replay, in order. Empty when the client is already caught up. */
  events: BufferedEvent[];
  /** true when the session isn't tracked (e.g. server restarted) and the
   *  client should assume state loss rather than "nothing to replay". */
  missed: boolean;
  /** The session's current highest seq (useful as an ack). */
  currentSeq: number;
}

interface SessionSlot {
  /** Monotonic seq for this session. Starts at 0; first event gets seq 1. */
  seq: number;
  /** Ring buffer of events, oldest first. Capped by MAX_ENTRIES and TTL. */
  events: BufferedEvent[];
}

/** Max events per session. 500 gives ~1 tool-loop turn of headroom. */
const MAX_ENTRIES = 500;

/** Events older than this are evicted on record/since. */
const TTL_MS = 5 * 60 * 1000;

export class ChatEventBuffer {
  private readonly sessions = new Map<string, SessionSlot>();
  /** Overridable for tests. */
  private readonly now: () => number;

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? (() => Date.now());
  }

  /**
   * Record an event for a session and return the enriched event (with seq
   * assigned). Callers should pass the returned event's payload/seq through
   * to the WS client so the client can track the high-water mark.
   */
  record(sessionId: string, type: string, payload: unknown): BufferedEvent {
    const slot = this.getOrCreate(sessionId);
    slot.seq += 1;
    const event: BufferedEvent = {
      seq: slot.seq,
      type,
      payload,
      ts: this.now(),
    };
    slot.events.push(event);
    this.evict(slot);
    return event;
  }

  /**
   * Get all events with seq > lastSeq. Returns missed:true when the session
   * isn't tracked at all (server restart loses the buffer) so the caller can
   * surface a clear "session lost" state instead of silently catching up.
   *
   * lastSeq = 0 from a fresh client means "give me everything in the buffer".
   */
  since(sessionId: string, lastSeq: number): ReplayResult {
    const slot = this.sessions.get(sessionId);
    if (!slot) {
      return { events: [], missed: true, currentSeq: 0 };
    }
    this.evict(slot);
    const events = slot.events.filter((e) => e.seq > lastSeq);
    return { events, missed: false, currentSeq: slot.seq };
  }

  /** Drop a session entirely (e.g. on chat:close). */
  drop(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Test/debug only — current size for the session. */
  sizeOf(sessionId: string): number {
    return this.sessions.get(sessionId)?.events.length ?? 0;
  }

  /** Test/debug only — current seq high-water for the session. */
  currentSeq(sessionId: string): number {
    return this.sessions.get(sessionId)?.seq ?? 0;
  }

  private getOrCreate(sessionId: string): SessionSlot {
    let slot = this.sessions.get(sessionId);
    if (!slot) {
      slot = { seq: 0, events: [] };
      this.sessions.set(sessionId, slot);
    }
    return slot;
  }

  private evict(slot: SessionSlot): void {
    const cutoff = this.now() - TTL_MS;
    // Time-based eviction: drop events older than TTL from the head.
    while (slot.events.length > 0 && slot.events[0]!.ts < cutoff) {
      slot.events.shift();
    }
    // Size-based eviction: keep only the newest MAX_ENTRIES.
    if (slot.events.length > MAX_ENTRIES) {
      slot.events.splice(0, slot.events.length - MAX_ENTRIES);
    }
  }
}
