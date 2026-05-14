/**
 * Smoke test for channel-def.ts (CHN-B s163 slice 1).
 *
 * Validates the v2 ChannelDefinition can be built without a live
 * discord.js Client. Real protocol behavior (login, message handling)
 * needs a live Client + bot token + Discord API — those are covered by
 * the test-VM e2e suite, not host unit tests.
 *
 * The point of this test is contract-conformance: the file compiles
 * AND the builder runs cleanly AND the resulting definition has the
 * expected shape.
 */
import { describe, it, expect } from "vitest";
import { createDiscordChannelDefV2 } from "./channel-def.js";
import type { DiscordConfig } from "./config.js";

function makeConfig(): DiscordConfig {
  return {
    botToken: "test-token-not-used-without-login",
    mentionOnly: true,
  };
}

describe("createDiscordChannelDefV2 — contract conformance", () => {
  it("builds without throwing", () => {
    const def = createDiscordChannelDefV2(makeConfig());
    expect(def.id).toBe("discord");
    expect(def.displayName).toBe("Discord");
  });

  it("declares the expected privileged intents in readPolicy", () => {
    const def = createDiscordChannelDefV2(makeConfig());
    expect(def.readPolicy.nativeIntents).toContain("Guilds");
    expect(def.readPolicy.nativeIntents).toContain("GuildMessages");
    expect(def.readPolicy.nativeIntents).toContain("MessageContent");
    expect(def.readPolicy.nativeIntents).toContain("GuildMembers");
    expect(def.readPolicy.nativeIntents).toContain("GuildPresences");
  });

  it("declares roles as default-on, presence/messages as default-off", () => {
    const def = createDiscordChannelDefV2(makeConfig());
    expect(def.readPolicy.canReadRoles.defaultOn).toBe(true);
    expect(def.readPolicy.canReadAllMessages.defaultOn).toBe(false);
    expect(def.readPolicy.canReadPresence.defaultOn).toBe(false);
  });

  it("ships zero bridge tools in the no-Client variant (tools added at activation)", () => {
    const def = createDiscordChannelDefV2(makeConfig());
    expect(def.bridgeTools).toEqual([]);
  });

  it("createProtocol returns a ChannelProtocol with all 9 required methods", () => {
    const def = createDiscordChannelDefV2(makeConfig());
    const protocol = def.createProtocol({
      config: {},
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      cageProvider: () => null,
      resolveEntity: async () => ({ entityId: "test", isPending: false }),
    });
    expect(typeof protocol.start).toBe("function");
    expect(typeof protocol.onEvent).toBe("function");
    expect(typeof protocol.listRooms).toBe("function");
    expect(typeof protocol.getRoom).toBe("function");
    expect(typeof protocol.subscribeRoom).toBe("function");
    expect(typeof protocol.postToRoom).toBe("function");
    expect(typeof protocol.searchMessages).toBe("function");
    expect(typeof protocol.getUser).toBe("function");
    expect(typeof protocol.listMembers).toBe("function");
  });
});
