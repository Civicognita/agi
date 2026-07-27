/**
 * EntityStore owner-marker + claim-token — s234 P3 durable owner designation
 * (replacing the hand-edited owner.channels config). VM-backed (createDbClient).
 *
 * NOTE: the owner marker + claim token are SINGLETON meta rows, so these tests
 * run serially and restore/clear state to avoid cross-test interference.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createDbClient, type DbClient } from "@agi/db-schema";
import { EntityStore } from "./store.js";

let dbClient: DbClient;
let store: EntityStore;
let priorOwner: string | undefined;

beforeAll(async () => {
  dbClient = createDbClient();
  store = new EntityStore(dbClient.db);
  priorOwner = await store.getOwnerEntityId(); // preserve any real owner
});

afterEach(async () => {
  // Restore the pre-existing owner (or none) and clear any test claim token.
  if (priorOwner !== undefined) await store.setOwnerEntityId(priorOwner);
  await store.clearOwnerClaimToken();
});

describe("EntityStore owner marker", () => {
  it("round-trips the durable owner entity id", async () => {
    const e = await store.createEntity({ type: "E", displayName: "Owner-test" });
    await store.setOwnerEntityId(e.id);
    expect(await store.getOwnerEntityId()).toBe(e.id);
  });

  it("overwrites a previous owner (single designated owner)", async () => {
    const a = await store.createEntity({ type: "E", displayName: "Owner-A" });
    const b = await store.createEntity({ type: "E", displayName: "Owner-B" });
    await store.setOwnerEntityId(a.id);
    await store.setOwnerEntityId(b.id);
    expect(await store.getOwnerEntityId()).toBe(b.id);
  });
});

describe("EntityStore owner-claim token", () => {
  it("stores, reads, and clears the one-time claim token", async () => {
    await store.setOwnerClaimToken("tok_abc123");
    expect(await store.getOwnerClaimToken()).toBe("tok_abc123");
    await store.clearOwnerClaimToken();
    expect(await store.getOwnerClaimToken()).toBeUndefined();
  });

  it("returns undefined when no token has been set", async () => {
    await store.clearOwnerClaimToken();
    expect(await store.getOwnerClaimToken()).toBeUndefined();
  });
});
