/**
 * Chat event relay tests.
 *
 * Validates the pattern the server.ts chat:send pipeline uses to relay
 * agent-invoker events to the WebSocket client: a mutable `currentRunId`
 * closed over by the event handlers, which is reassigned per
 * injection-follow-up run so events for the new run are stamped with the
 * new runId (not the stale outer runId — the bug this replaces).
 *
 * Also exercises the listener cleanup pattern: handlers detach in finally()
 * so subsequent chat:send calls don't accumulate duplicate listeners.
 */

import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";

describe("chat event relay \u2014 currentRunId closure", () => {
  interface RelayedEvent {
    runId: string;
    toolName?: string;
    thought?: string;
  }

  function makeRelay(emitter: EventEmitter, initialRunId: string) {
    let currentRunId = initialRunId;
    const captured: RelayedEvent[] = [];

    const toolStartHandler = (data: { toolName: string }) => {
      captured.push({ runId: currentRunId, toolName: data.toolName });
    };
    const thoughtHandler = (data: { content: string }) => {
      captured.push({ runId: currentRunId, thought: data.content });
    };

    emitter.on("tool_start", toolStartHandler);
    emitter.on("thought", thoughtHandler);

    const detach = () => {
      emitter.removeListener("tool_start", toolStartHandler);
      emitter.removeListener("thought", thoughtHandler);
    };

    return {
      captured,
      setCurrentRunId: (id: string) => { currentRunId = id; },
      detach,
    };
  }

  it("events emitted during the initial run are stamped with the initial runId", () => {
    const emitter = new EventEmitter();
    const relay = makeRelay(emitter, "run-A");

    emitter.emit("tool_start", { toolName: "file_read" });
    emitter.emit("thought", { content: "hmm" });

    expect(relay.captured).toEqual([
      { runId: "run-A", toolName: "file_read" },
      { runId: "run-A", thought: "hmm" },
    ]);

    relay.detach();
  });

  it("after setCurrentRunId, subsequent events are stamped with the new runId", () => {
    // This is the fix for the server-side bug: the closure held a const `runId`
    // which meant events emitted during an injection follow-up run were stamped
    // with the outer run's id, corrupting the client's run grouping.
    const emitter = new EventEmitter();
    const relay = makeRelay(emitter, "run-A");

    emitter.emit("tool_start", { toolName: "file_read" });
    relay.setCurrentRunId("run-INJECT");
    emitter.emit("tool_start", { toolName: "shell_exec" });
    emitter.emit("thought", { content: "acknowledged" });

    expect(relay.captured).toEqual([
      { runId: "run-A", toolName: "file_read" },
      { runId: "run-INJECT", toolName: "shell_exec" },
      { runId: "run-INJECT", thought: "acknowledged" },
    ]);

    relay.detach();
  });

  it("detach removes listeners — subsequent emissions are ignored and the EventEmitter reports zero listeners", () => {
    // This mirrors the .finally() cleanup in server.ts: without it, every
    // chat:send accumulated duplicate listeners on the shared AgentInvoker
    // EventEmitter, causing duplicate WS events for the same agent emission.
    const emitter = new EventEmitter();
    const relay = makeRelay(emitter, "run-A");
    emitter.emit("tool_start", { toolName: "first" });
    expect(relay.captured).toHaveLength(1);

    relay.detach();

    emitter.emit("tool_start", { toolName: "ignored" });
    expect(relay.captured).toHaveLength(1);
    expect(emitter.listenerCount("tool_start")).toBe(0);
    expect(emitter.listenerCount("thought")).toBe(0);
  });
});

describe("chat event relay \u2014 injection_consumed", () => {
  interface ConsumedEvent {
    sessionId: string;
    count: number;
  }

  function makeInjectionRelay(emitter: EventEmitter, sessionKey: string, sessionId: string) {
    const captured: ConsumedEvent[] = [];
    const handler = (data: { sessionKey: string; count: number }) => {
      if (data.sessionKey !== sessionKey) return;
      captured.push({ sessionId, count: data.count });
    };
    emitter.on("injection_consumed", handler);
    return {
      captured,
      detach: () => emitter.removeListener("injection_consumed", handler),
    };
  }

  it("relays injection_consumed events scoped to the subscribing sessionKey", () => {
    const emitter = new EventEmitter();
    const relay = makeInjectionRelay(emitter, "ent-001:web:sess-1", "sess-1");

    emitter.emit("injection_consumed", { sessionKey: "ent-001:web:sess-1", count: 2 });
    emitter.emit("injection_consumed", { sessionKey: "other:web:sess-9", count: 1 });
    emitter.emit("injection_consumed", { sessionKey: "ent-001:web:sess-1", count: 1 });

    expect(relay.captured).toEqual([
      { sessionId: "sess-1", count: 2 },
      { sessionId: "sess-1", count: 1 },
    ]);

    relay.detach();
  });
});
