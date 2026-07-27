/**
 * EntityStore.associateChannelAccount — s234 P2 "associate to existing person".
 *
 * Runs against the test VM's real agi_data Postgres (createDbClient), isolated
 * per test via unique channel user ids. Covers the Owner approval path where a
 * pending channel account is linked onto an EXISTING local identity instead of
 * minting a new one.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ulid } from "ulid";
import { createDbClient, type DbClient } from "@agi/db-schema";
import { EntityStore } from "./store.js";

let dbClient: DbClient;
let store: EntityStore;

beforeAll(() => {
  dbClient = createDbClient();
  store = new EntityStore(dbClient.db);
});

function uid(): string {
  return `assoc-${ulid()}`;
}

describe("EntityStore.associateChannelAccount", () => {
  it("reassigns a channel account onto an existing entity and retires the throwaway", async () => {
    const target = await store.createEntity({ type: "E", displayName: "Alice (existing)" });
    const channelUserId = uid();
    // Simulate first inbound: a throwaway entity auto-created for the new account.
    const throwaway = await store.resolveOrCreate("discord", channelUserId, "AliceOnDiscord");
    expect(throwaway.id).not.toBe(target.id);

    const result = await store.associateChannelAccount({ channel: "discord", channelUserId, targetEntityId: target.id });
    expect(result.id).toBe(target.id);

    // The account now resolves to the target identity, not the throwaway.
    const resolved = await store.resolveEntityByChannel("discord", channelUserId);
    expect(resolved?.id).toBe(target.id);
    const targetAccounts = await store.getChannelAccounts(target.id);
    expect(targetAccounts.some((a) => a.channelUserId === channelUserId)).toBe(true);

    // The orphaned throwaway has no accounts left and is downgraded.
    const orphanAccounts = await store.getChannelAccounts(throwaway.id);
    expect(orphanAccounts.length).toBe(0);
    const orphan = await store.getEntity(throwaway.id);
    expect(orphan?.verificationTier).toBe("unverified");
  });

  it("is idempotent when the account is already on the target (no duplicate row)", async () => {
    const target = await store.createEntity({ type: "E", displayName: "Bob" });
    const channelUserId = uid();
    await store.linkChannelAccount({ entityId: target.id, channel: "discord", channelUserId });

    const result = await store.associateChannelAccount({ channel: "discord", channelUserId, targetEntityId: target.id });
    expect(result.id).toBe(target.id);
    const accounts = await store.getChannelAccounts(target.id);
    expect(accounts.filter((a) => a.channelUserId === channelUserId).length).toBe(1);
  });

  it("links fresh when the channel account has no existing entity", async () => {
    const target = await store.createEntity({ type: "E", displayName: "Carol" });
    const channelUserId = uid();
    const result = await store.associateChannelAccount({ channel: "discord", channelUserId, targetEntityId: target.id });
    expect(result.id).toBe(target.id);
    const resolved = await store.resolveEntityByChannel("discord", channelUserId);
    expect(resolved?.id).toBe(target.id);
  });

  it("throws when the target entity does not exist", async () => {
    const channelUserId = uid();
    await store.resolveOrCreate("discord", channelUserId, "Dave");
    await expect(
      store.associateChannelAccount({ channel: "discord", channelUserId, targetEntityId: "nonexistent-entity-id-xyz" }),
    ).rejects.toThrow(/not found/);
  });

  it("keeps two distinct channel accounts on one identity (multi-account person)", async () => {
    const target = await store.createEntity({ type: "E", displayName: "Eve" });
    const discordId = uid();
    const telegramId = uid();
    await store.resolveOrCreate("discord", discordId, "EveDiscord");
    await store.resolveOrCreate("telegram", telegramId, "EveTelegram");

    await store.associateChannelAccount({ channel: "discord", channelUserId: discordId, targetEntityId: target.id });
    await store.associateChannelAccount({ channel: "telegram", channelUserId: telegramId, targetEntityId: target.id });

    const accounts = await store.getChannelAccounts(target.id);
    const keys = accounts.map((a) => `${a.channel}:${a.channelUserId}`);
    expect(keys).toContain(`discord:${discordId}`);
    expect(keys).toContain(`telegram:${telegramId}`);
  });
});
