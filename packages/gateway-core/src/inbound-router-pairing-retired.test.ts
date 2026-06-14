/**
 * InboundRouter — legacy pairing-code gate retired (2026-06-08).
 *
 * Owner-reported: Aionima DM'd a pairing code ("you need my owner's approval,
 * your code: XXX") to every non-owner who messaged it in Discord, and dropped
 * the message. That legacy gate (Step 0b) pre-empted the modern pending-approval
 * flow, so /identity/pending stayed empty.
 *
 * These tests pin the NEW contract: no pairing code is ever generated/sent for
 * an unknown non-owner; instead the contact is captured as a pending approval
 * (dashboard flow) and the message still reaches the agent queue (s194 —
 * unbound room, no project scope to strip).
 */

import { describe, it, expect, vi } from "vitest";
import { InboundRouter, type InboundRouterDeps } from "./inbound-router.js";
import type { AionimaMessage } from "@agi/plugins";

function buildRouter() {
  const entityStore = {
    resolveOrCreate: vi.fn(async () => ({
      id: "ent-1", coaAlias: "alias-1", displayName: "Stranger", verificationTier: "unverified",
    })),
    updateEntity: vi.fn(async () => {}),
    resolveEntityByChannel: vi.fn(async () => null),
  };
  const messageQueue = { enqueue: vi.fn(async () => ({ id: "q-1" })) };
  const pairingStore = {
    isApproved: vi.fn(() => false),
    createRequest: vi.fn(() => ({ code: "123456", channel: "discord", channelUserId: "stranger", displayName: "Stranger" })),
  };
  const pendingApprovalStore = {
    capture: vi.fn((_input: { channelId: string; roomId: string; channelUserId: string; displayName: string; firstMessagePreview: string; projectPath?: string }) => ({ id: "discord::dm-1::stranger" })),
    decisionFor: vi.fn(() => null),
    getByChannelUser: vi.fn(() => null),
  };
  const outboundSender = vi.fn(async (_channelId: string, _channelUserId: string, _content: { type: string; text?: string }) => {});

  const deps = {
    entityStore,
    messageQueue,
    coaLogger: {},
    resourceId: "$A0",
    nodeId: "@A0",
    ownerConfig: { displayName: "Owner", channels: { discord: "owner-id" }, dmPolicy: "pairing" },
    pairingStore,
    outboundSender,
    pendingApprovalStore,
  } as unknown as InboundRouterDeps;

  return { router: new InboundRouter(deps), entityStore, messageQueue, pairingStore, pendingApprovalStore, outboundSender };
}

function strangerMsg(text = "hi"): AionimaMessage {
  return {
    id: "m1",
    timestamp: "2026-06-08T00:00:00Z",
    channelId: "discord",
    channelUserId: "stranger",
    content: { type: "text", text },
    metadata: { roomId: "dm-1", displayName: "Stranger" },
  } as unknown as AionimaMessage;
}

describe("InboundRouter — legacy pairing-code gate retired", () => {
  it("does NOT generate a pairing code for an unknown non-owner", async () => {
    const { router, pairingStore } = buildRouter();
    await router.route(strangerMsg());
    expect(pairingStore.createRequest).not.toHaveBeenCalled();
  });

  it("never DMs a message containing a pairing code", async () => {
    const { router, outboundSender } = buildRouter();
    await router.route(strangerMsg());
    for (const call of outboundSender.mock.calls) {
      expect(call[2]?.text ?? "").not.toMatch(/pairing code/i);
    }
  });

  it("captures the unknown contact as a pending approval (dashboard flow)", async () => {
    const { router, pendingApprovalStore } = buildRouter();
    await router.route(strangerMsg("hello aion"));
    expect(pendingApprovalStore.capture).toHaveBeenCalledTimes(1);
    const arg = pendingApprovalStore.capture.mock.calls[0]![0];
    expect(arg.channelId).toBe("discord");
    expect(arg.roomId).toBe("dm-1");
    expect(arg.channelUserId).toBe("stranger");
  });

  it("still routes the unknown user's message to the agent queue (s194, unbound room)", async () => {
    const { router, messageQueue } = buildRouter();
    const result = await router.route(strangerMsg());
    expect(messageQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(result?.queueMessageId).toBe("q-1");
  });

  it("still lets the owner's own (non-command) messages through", async () => {
    const { router, messageQueue } = buildRouter();
    const ownerMsg = { ...strangerMsg("hey aion"), channelUserId: "owner-id" } as AionimaMessage;
    const result = await router.route(ownerMsg);
    expect(messageQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });
});
