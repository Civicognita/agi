/**
 * Smoke test for the noop-channel reference example.
 *
 * Purpose: pull the example into the test surface so it's exercised by
 * `pnpm test` in addition to `pnpm typecheck`. Validates that:
 *   - the example compiles + builds via defineChannelV2 (runtime
 *     validation passes — no thrown errors)
 *   - protocol methods return the contracted shapes (empty lists, null
 *     getters, well-formed outbound message)
 *   - the bridge tool's noop handler returns the expected sentinel
 *
 * If the SDK contract changes in a breaking way, this test breaks
 * loudly (in addition to the typecheck failure). That double-gate is
 * the point of having both an example AND a smoke test.
 */
import { describe, it, expect } from "vitest";
import noopChannel from "./noop-channel.example.js";

describe("noop-channel reference example", () => {
  it("builds via defineChannelV2 without throwing", () => {
    expect(noopChannel.id).toBe("noop");
    expect(noopChannel.displayName).toBe("Noop Channel (reference example)");
  });

  it("exposes the expected bridge tool", () => {
    expect(noopChannel.bridgeTools).toHaveLength(1);
    expect(noopChannel.bridgeTools[0]?.name).toBe("ping");
  });

  it("ping bridge tool returns 'pong'", async () => {
    const tool = noopChannel.bridgeTools[0];
    expect(tool).toBeDefined();
    const result = await tool!.handler({}, {
      config: {},
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      cageProvider: () => null,
      resolveEntity: async () => ({ entityId: "noop", isPending: false }),
    });
    expect(result).toBe("pong");
  });

  it("protocol implements the ChannelProtocol contract", async () => {
    const protocol = noopChannel.createProtocol({
      config: {},
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      cageProvider: () => null,
      resolveEntity: async () => ({ entityId: "noop", isPending: false }),
    });
    const handle = await protocol.start();
    expect(typeof handle.stop).toBe("function");
    await handle.stop();

    expect(await protocol.listRooms()).toEqual([]);
    expect(await protocol.getRoom("any")).toBeNull();
    expect(await protocol.getUser("any")).toBeNull();
    expect(await protocol.listMembers({ roomId: "any" })).toEqual([]);

    const sent = await protocol.postToRoom("room1", { text: "hello" });
    expect(sent.roomId).toBe("room1");
    expect(sent.text).toBe("hello");
    expect(sent.authorId).toBe("noop-bot");
    expect(sent.mentionsBot).toBe(false);

    const page = await protocol.searchMessages("room1", {});
    expect(page.messages).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it("declares a permissive-by-default-off read policy", () => {
    expect(noopChannel.readPolicy.canReadAllMessages.defaultOn).toBe(false);
    expect(noopChannel.readPolicy.canReadPresence.defaultOn).toBe(false);
    expect(noopChannel.readPolicy.canReadRoles.defaultOn).toBe(false);
    expect(noopChannel.readPolicy.nativeIntents).toEqual([]);
  });
});
