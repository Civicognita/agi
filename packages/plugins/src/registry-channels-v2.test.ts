/**
 * Tests for the v2 channel registry methods (CHN-B s163 slice 2).
 *
 * Validates that addChannelV2/getChannelsV2/getChannelV2 keep the v2
 * registry separate from the legacy channels[] field, dedupe by
 * channelId, and treat the definition as opaque (unknown).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PluginRegistry } from "./registry.js";

describe("PluginRegistry — v2 channel registration", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it("starts with an empty v2 channels list", () => {
    expect(registry.getChannelsV2()).toEqual([]);
  });

  it("registers a v2 channel + retrieves it by id", () => {
    const def = { id: "discord", displayName: "Discord" };
    registry.addChannelV2("@agi/channel-discord", "discord", def);
    expect(registry.getChannelsV2()).toHaveLength(1);
    const entry = registry.getChannelV2("discord");
    expect(entry).toBeDefined();
    expect(entry?.pluginId).toBe("@agi/channel-discord");
    expect(entry?.channelId).toBe("discord");
    expect(entry?.definition).toBe(def);
  });

  it("dedupes by channelId — first-registered wins", () => {
    const first = { id: "discord", source: "first" };
    const second = { id: "discord", source: "second" };
    registry.addChannelV2("@agi/channel-discord", "discord", first);
    registry.addChannelV2("@agi/channel-discord-fork", "discord", second);
    expect(registry.getChannelsV2()).toHaveLength(1);
    const entry = registry.getChannelV2("discord");
    expect(entry).toBeDefined();
    expect((entry!.definition as { source: string }).source).toBe("first");
  });

  it("keeps multiple channelIds separate", () => {
    registry.addChannelV2("@agi/channel-discord", "discord", { id: "discord" });
    registry.addChannelV2("@agi/channel-telegram", "telegram", { id: "telegram" });
    expect(registry.getChannelsV2()).toHaveLength(2);
    expect(registry.getChannelV2("discord")?.pluginId).toBe("@agi/channel-discord");
    expect(registry.getChannelV2("telegram")?.pluginId).toBe("@agi/channel-telegram");
  });

  it("returns undefined for unregistered channelId", () => {
    expect(registry.getChannelV2("nonexistent")).toBeUndefined();
  });

  it("v2 registry is structurally separate from legacy channels", () => {
    registry.addChannel("@agi/channel-discord", "discord");
    registry.addChannelV2("@agi/channel-discord", "discord", { id: "discord" });
    // Both registered; both queryable. Neither shadows the other.
    expect(registry.getChannels()).toHaveLength(1);
    expect(registry.getChannelsV2()).toHaveLength(1);
  });

  it("getChannelsV2 returns a defensive copy (no aliasing)", () => {
    registry.addChannelV2("@agi/channel-discord", "discord", { id: "discord" });
    const list = registry.getChannelsV2();
    list.push({ pluginId: "rogue", channelId: "rogue", definition: {} });
    expect(registry.getChannelsV2()).toHaveLength(1);
  });
});
