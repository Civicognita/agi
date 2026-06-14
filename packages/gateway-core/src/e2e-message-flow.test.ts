// @ts-nocheck -- blocks on pg-backed test harness; tracked in _plans/phase2-tests-pg.md
/**
 * E2E Message Flow Tests — Story 10, Tasks 22-25
 *
 * Tests the full message flow through the gateway pipeline:
 *   1. Inbound routing → entity creation/lookup → queue enqueue
 *   2. Queue dequeue → agent invocation → outbound dispatch
 *   3. Multi-channel message routing
 *   4. Error handling and edge cases
 *
 * Uses the real InboundRouter, EntityStore, MessageQueue, and
 * OutboundDispatcher with mock channel adapters.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { createDatabase, EntityStore, MessageQueue } from "@agi/entity-model";
import { COAChainLogger } from "@agi/coa-chain";

import { InboundRouter } from "./inbound-router.js";
import { OutboundDispatcher } from "./outbound-dispatcher.js";
import { GatewayStateMachine } from "./state-machine.js";

import type { AionimaMessage, ChannelId } from "@agi/plugins";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestMessage(channel: string, userId: string, text: string): AionimaMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    channelId: channel as ChannelId,
    channelUserId: userId,
    content: { type: "text", text },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skip("E2E Message Flow", () => {
  let db: ReturnType<typeof createDatabase>;
  let entityStore: EntityStore;
  let messageQueue: MessageQueue;
  let coaLogger: COAChainLogger;
  let inboundRouter: InboundRouter;

  beforeEach(() => {
    db = createDatabase(":memory:");
    entityStore = new EntityStore(db);
    messageQueue = new MessageQueue(db);
    coaLogger = new COAChainLogger(db);
    inboundRouter = new InboundRouter({
      entityStore,
      messageQueue,
      coaLogger,
      resourceId: "$A0",
      nodeId: "@A0",
    });
  });

  it("Task 22: inbound routing creates entity and enqueues message", async () => {
    const msg = createTestMessage("telegram", "user123", "Hello, Aionima!");

    const result = (await inboundRouter.route(msg))!;

    // Entity should be created
    expect(result.entityId).toBeTruthy();
    expect(result.queueMessageId).toBeTruthy();

    // Entity should be retrievable
    const entity = entityStore.getEntity(result.entityId);
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe("E");

    // Message should be in queue
    const pending = messageQueue.peek();
    expect(pending.length).toBe(1);
    expect(String(pending[0]!.channel)).toBe("telegram");
  });

  it("Task 22: subsequent messages reuse the same entity", async () => {
    const msg1 = createTestMessage("telegram", "user456", "First message");
    const msg2 = createTestMessage("telegram", "user456", "Second message");

    const result1 = (await inboundRouter.route(msg1))!;
    const result2 = (await inboundRouter.route(msg2))!;

    expect(result1.entityId).toBe(result2.entityId);
  });

  it("Task 23: different users create different entities", async () => {
    const msg1 = createTestMessage("telegram", "alice", "Hello");
    const msg2 = createTestMessage("telegram", "bob", "Hello");

    const result1 = (await inboundRouter.route(msg1))!;
    const result2 = (await inboundRouter.route(msg2))!;

    expect(result1.entityId).not.toBe(result2.entityId);
  });

  it("Task 23: same user on different channels creates separate queue messages", async () => {
    const msg1 = createTestMessage("telegram", "user789", "From Telegram");
    const msg2 = createTestMessage("discord", "user789", "From Discord");

    const result1 = (await inboundRouter.route(msg1))!;
    const result2 = (await inboundRouter.route(msg2))!;

    expect(result1.queueMessageId).not.toBe(result2.queueMessageId);
  });

  it("Task 24: outbound dispatcher sends via correct channel adapter", async () => {
    // Create a real entity first (COA has FK constraint on entity_id)
    const entity = entityStore.resolveOrCreate("telegram", "user123", "TestUser");
    const sentMessages: Array<{ userId: string; text: string }> = [];

    const dispatcher = new OutboundDispatcher({
      getChannelAdapter: (channelId: string) => {
        if (channelId === "telegram") {
          return {
            send: async (channelUserId: string, content: { type: string; text?: string }) => {
              sentMessages.push({ userId: channelUserId, text: content.text ?? "" });
            },
          };
        }
        return undefined;
      },
      coaLogger,
      resolveCoaAlias: () => entity.coaAlias,
      resourceId: "$A0",
      nodeId: "@A0",
    });

    await dispatcher.dispatch({
      channelId: "telegram",
      channelUserId: "user123",
      entityId: entity.id,
      content: { type: "text", text: "Response from Aionima" },
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]!.text).toBe("Response from Aionima");
    expect(sentMessages[0]!.userId).toBe("user123");
  });

  it("Task 24: outbound dispatcher throws for unknown channel", async () => {
    const dispatcher = new OutboundDispatcher({
      getChannelAdapter: () => undefined,
      coaLogger,
      resolveCoaAlias: () => "#E0",
      resourceId: "$A0",
      nodeId: "@A0",
    });

    await expect(
      dispatcher.dispatch({
        channelId: "nonexistent",
        channelUserId: "user123",
        entityId: "entity-001",
        content: { type: "text", text: "Hello" },
      }),
    ).rejects.toThrow("Channel not found");
  });

  it("Task 25: COA fingerprints are generated for each route operation", async () => {
    const msg = createTestMessage("telegram", "coa-test-user", "Test COA");

    const result = (await inboundRouter.route(msg))!;

    expect(result.coaFingerprint).toBeTruthy();
    // COA fingerprint should follow the $R.#E.@N.CXXX format
    expect(result.coaFingerprint).toContain("$A0");

    // Entity should have a COA alias
    const entity = entityStore.getEntity(result.entityId);
    expect(entity).not.toBeNull();
    expect(entity!.coaAlias).toMatch(/^#E/);
  });

  it("Task 25: message queue respects ordering", async () => {
    const msg1 = createTestMessage("telegram", "order-user", "First");
    const msg2 = createTestMessage("telegram", "order-user", "Second");
    const msg3 = createTestMessage("telegram", "order-user", "Third");

    (await inboundRouter.route(msg1))!;
    (await inboundRouter.route(msg2))!;
    (await inboundRouter.route(msg3))!;

    const pending = messageQueue.peek();
    expect(pending.length).toBe(3);

    // Messages should be in FIFO order
    const payloads = pending.map((m) => {
      const p = m.payload as { message?: AionimaMessage };
      return p.message?.content?.type === "text" ? (p.message.content as { text: string }).text : "";
    });
    expect(payloads).toEqual(["First", "Second", "Third"]);
  });

  it("Task 25: state machine gates operations correctly", () => {
    const sm = new GatewayStateMachine("UNKNOWN");

    // In UNKNOWN state, capabilities should be restricted
    const caps = sm.getCapabilities();
    expect(caps.remoteOps).toBe(false);
    expect(caps.tynn).toBe(false);
    expect(caps.memory).toBe(false);
    expect(caps.deletions).toBe(false);

    // Transition to ONLINE
    if (sm.canTransition("ONLINE")) {
      sm.transition("ONLINE");
    }
    const onlineCaps = sm.getCapabilities();
    expect(onlineCaps.remoteOps).toBe(true);
  });
});

