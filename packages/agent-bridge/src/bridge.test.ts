import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChannelId, OutboundContent } from "@aionima/channel-sdk";
import type { QueueMessage } from "@aionima/entity-model";
import { AgentBridge } from "./bridge.js";
import type { BridgeDispatcher, BridgeBroadcaster, HeldMessage } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_ID = "telegram" as ChannelId;

function makeQueueMessage(overrides?: Partial<QueueMessage>): QueueMessage {
  return {
    id: "msg-001",
    channel: CHANNEL_ID,
    direction: "inbound",
    status: "pending",
    retries: 0,
    createdAt: "2026-01-01T00:00:00Z",
    processedAt: null,
    payload: {
      entityId: "entity-abc",
      coaFingerprint: "coa-fp-xyz",
      message: {
        id: "aionima-msg-001",
        channelId: CHANNEL_ID,
        channelUserId: "user-123",
        timestamp: "2026-01-01T00:00:00Z",
        content: { type: "text", text: "Hello" },
        metadata: { firstName: "Alice" },
      },
    },
    ...overrides,
  };
}

const OUTBOUND_CONTENT: OutboundContent = { type: "text", text: "Hi there" };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockDispatch: ReturnType<typeof vi.fn>;
let mockBroadcast: ReturnType<typeof vi.fn>;
let dispatcher: BridgeDispatcher;
let broadcaster: BridgeBroadcaster;
let bridge: AgentBridge;

beforeEach(() => {
  mockDispatch = vi.fn().mockResolvedValue({
    coaFingerprint: "mock-fp",
    deliveredAt: "2026-01-01T00:00:00Z",
  });

  mockBroadcast = vi.fn();

  dispatcher = { dispatch: mockDispatch };
  broadcaster = { broadcast: mockBroadcast };

  bridge = new AgentBridge({ dispatcher, broadcaster });
});

// ---------------------------------------------------------------------------
// notify()
// ---------------------------------------------------------------------------

describe("AgentBridge.notify", () => {
  it("holds the message (heldCount increases)", async () => {
    expect(bridge.heldCount).toBe(0);
    await bridge.notify(makeQueueMessage());
    expect(bridge.heldCount).toBe(1);
  });

  it("broadcasts 'message_received' with correct payload", async () => {
    const msg = makeQueueMessage();
    await bridge.notify(msg);

    expect(mockBroadcast).toHaveBeenCalledOnce();
    expect(mockBroadcast).toHaveBeenCalledWith(
      "message_received",
      expect.objectContaining({
        queueMessageId: "msg-001",
        entityId: "entity-abc",
        channelId: CHANNEL_ID,
        channelUserId: "user-123",
        coaFingerprint: "coa-fp-xyz",
      }),
    );
  });

  it("emits 'message_held' event with held message", async () => {
    const msg = makeQueueMessage();
    const emitted: HeldMessage[] = [];
    bridge.on("message_held", (held: HeldMessage) => emitted.push(held));

    await bridge.notify(msg);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      queueMessageId: "msg-001",
      entityId: "entity-abc",
      channelId: CHANNEL_ID,
      channelUserId: "user-123",
      coaFingerprint: "coa-fp-xyz",
    });
  });

  it("extracts channelUserId from payload.message", async () => {
    const msg = makeQueueMessage({ id: "msg-cu" });
    await bridge.notify(msg);

    const held = bridge.getHeldMessage("msg-cu");
    expect(held?.channelUserId).toBe("user-123");
  });

  it("extracts displayName from payload.message.metadata.firstName", async () => {
    await bridge.notify(makeQueueMessage());

    const held = bridge.getHeldMessage("msg-001");
    expect(held?.displayName).toBe("Alice");
  });

  it("displayName is undefined when metadata has no firstName", async () => {
    const msg = makeQueueMessage({
      id: "msg-no-name",
      payload: {
        entityId: "entity-abc",
        coaFingerprint: "coa-fp-xyz",
        message: {
          id: "aionima-msg-002",
          channelId: CHANNEL_ID,
          channelUserId: "user-456",
          timestamp: "2026-01-01T00:00:00Z",
          content: { type: "text", text: "Hi" },
          metadata: { otherField: "value" },
        },
      },
    });
    await bridge.notify(msg);

    const held = bridge.getHeldMessage("msg-no-name");
    expect(held?.displayName).toBeUndefined();
  });

  it("displayName is undefined when metadata is absent", async () => {
    const msg = makeQueueMessage({
      id: "msg-no-meta",
      payload: {
        entityId: "entity-abc",
        coaFingerprint: "coa-fp-xyz",
        message: {
          id: "aionima-msg-003",
          channelId: CHANNEL_ID,
          channelUserId: "user-789",
          timestamp: "2026-01-01T00:00:00Z",
          content: { type: "text", text: "Hi" },
        },
      },
    });
    await bridge.notify(msg);

    const held = bridge.getHeldMessage("msg-no-meta");
    expect(held?.displayName).toBeUndefined();
  });

  it("multiple notify calls hold multiple messages", async () => {
    await bridge.notify(makeQueueMessage({ id: "msg-A" }));
    await bridge.notify(makeQueueMessage({ id: "msg-B" }));
    await bridge.notify(makeQueueMessage({ id: "msg-C" }));

    expect(bridge.heldCount).toBe(3);
    expect(bridge.getHeldMessage("msg-A")).toBeDefined();
    expect(bridge.getHeldMessage("msg-B")).toBeDefined();
    expect(bridge.getHeldMessage("msg-C")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// handleReply()
// ---------------------------------------------------------------------------

describe("AgentBridge.handleReply", () => {
  beforeEach(async () => {
    await bridge.notify(makeQueueMessage());
  });

  it("dispatches with correct channelId, channelUserId, entityId, inReplyTo", async () => {
    await bridge.handleReply("msg-001", OUTBOUND_CONTENT);

    expect(mockDispatch).toHaveBeenCalledOnce();
    expect(mockDispatch).toHaveBeenCalledWith({
      channelId: CHANNEL_ID,
      channelUserId: "user-123",
      content: OUTBOUND_CONTENT,
      entityId: "entity-abc",
      inReplyTo: "msg-001",
    });
  });

  it("removes message from held after successful reply", async () => {
    expect(bridge.heldCount).toBe(1);
    await bridge.handleReply("msg-001", OUTBOUND_CONTENT);
    expect(bridge.heldCount).toBe(0);
    expect(bridge.getHeldMessage("msg-001")).toBeUndefined();
  });

  it("broadcasts 'reply_sent' with coaFingerprint and sentAt", async () => {
    await bridge.handleReply("msg-001", OUTBOUND_CONTENT);

    expect(mockBroadcast).toHaveBeenLastCalledWith(
      "reply_sent",
      expect.objectContaining({
        queueMessageId: "msg-001",
        coaFingerprint: "mock-fp",
        sentAt: "2026-01-01T00:00:00Z",
      }),
    );
  });

  it("emits 'reply_sent' event on success", async () => {
    const emitted: unknown[] = [];
    bridge.on("reply_sent", (data: unknown) => emitted.push(data));

    await bridge.handleReply("msg-001", OUTBOUND_CONTENT);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      queueMessageId: "msg-001",
      coaFingerprint: "mock-fp",
      sentAt: "2026-01-01T00:00:00Z",
    });
  });

  it("throws when message ID not found in held", async () => {
    await expect(
      bridge.handleReply("nonexistent-id", OUTBOUND_CONTENT),
    ).rejects.toThrow("Held message not found: nonexistent-id");
  });

  it("on dispatch failure: broadcasts 'error' with code REPLY_FAILED", async () => {
    const dispatchError = new Error("channel adapter offline");
    mockDispatch.mockRejectedValueOnce(dispatchError);

    await expect(bridge.handleReply("msg-001", OUTBOUND_CONTENT)).rejects.toThrow();

    expect(mockBroadcast).toHaveBeenLastCalledWith(
      "error",
      expect.objectContaining({
        code: "REPLY_FAILED",
        message: "channel adapter offline",
        relatedMessageId: "msg-001",
      }),
    );
  });

  it("on dispatch failure: emits 'reply_failed' event", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("network timeout"));
    const emitted: unknown[] = [];
    bridge.on("reply_failed", (data: unknown) => emitted.push(data));

    await expect(bridge.handleReply("msg-001", OUTBOUND_CONTENT)).rejects.toThrow();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      code: "REPLY_FAILED",
      relatedMessageId: "msg-001",
    });
  });

  it("on dispatch failure: message remains held (NOT removed)", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("send failed"));

    await expect(bridge.handleReply("msg-001", OUTBOUND_CONTENT)).rejects.toThrow();

    expect(bridge.heldCount).toBe(1);
    expect(bridge.getHeldMessage("msg-001")).toBeDefined();
  });

  it("on dispatch failure: re-throws the original error", async () => {
    const dispatchError = new Error("upstream failure");
    mockDispatch.mockRejectedValueOnce(dispatchError);

    await expect(bridge.handleReply("msg-001", OUTBOUND_CONTENT)).rejects.toThrow(
      "upstream failure",
    );
  });
});

// ---------------------------------------------------------------------------
// getHeldMessages()
// ---------------------------------------------------------------------------

describe("AgentBridge.getHeldMessages", () => {
  it("returns empty array when no messages held", () => {
    expect(bridge.getHeldMessages()).toEqual([]);
  });

  it("returns all held messages", async () => {
    await bridge.notify(makeQueueMessage({ id: "msg-1" }));
    await bridge.notify(makeQueueMessage({ id: "msg-2" }));

    const held = bridge.getHeldMessages();
    expect(held).toHaveLength(2);
    const ids = held.map((h) => h.queueMessageId);
    expect(ids).toContain("msg-1");
    expect(ids).toContain("msg-2");
  });

  it("returns a new array (not a reference to internal state)", async () => {
    await bridge.notify(makeQueueMessage({ id: "msg-ref" }));

    const first = bridge.getHeldMessages();
    const second = bridge.getHeldMessages();

    expect(first).not.toBe(second);
    // Mutating the returned array does not affect internal state
    first.pop();
    expect(bridge.heldCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getHeldMessage()
// ---------------------------------------------------------------------------

describe("AgentBridge.getHeldMessage", () => {
  it("returns held message by ID", async () => {
    await bridge.notify(makeQueueMessage({ id: "msg-find-me" }));

    const held = bridge.getHeldMessage("msg-find-me");
    expect(held).toBeDefined();
    expect(held?.queueMessageId).toBe("msg-find-me");
  });

  it("returns undefined for unknown ID", () => {
    const held = bridge.getHeldMessage("does-not-exist");
    expect(held).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// heldCount
// ---------------------------------------------------------------------------

describe("AgentBridge.heldCount", () => {
  it("returns 0 when empty", () => {
    expect(bridge.heldCount).toBe(0);
  });

  it("increments with each notify call", async () => {
    await bridge.notify(makeQueueMessage({ id: "hc-1" }));
    expect(bridge.heldCount).toBe(1);

    await bridge.notify(makeQueueMessage({ id: "hc-2" }));
    expect(bridge.heldCount).toBe(2);
  });

  it("decrements after a successful handleReply", async () => {
    await bridge.notify(makeQueueMessage({ id: "hc-dec" }));
    expect(bridge.heldCount).toBe(1);

    await bridge.handleReply("hc-dec", OUTBOUND_CONTENT);
    expect(bridge.heldCount).toBe(0);
  });

  it("does not decrement after a failed handleReply", async () => {
    await bridge.notify(makeQueueMessage({ id: "hc-fail" }));
    mockDispatch.mockRejectedValueOnce(new Error("dispatch down"));

    await expect(bridge.handleReply("hc-fail", OUTBOUND_CONTENT)).rejects.toThrow();
    expect(bridge.heldCount).toBe(1);
  });
});
