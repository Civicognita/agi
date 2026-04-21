// @ts-nocheck -- blocks on pg-backed test harness; tracked in _plans/phase2-tests-pg.md
import { describe, it, expect, beforeEach } from "vitest";
// import { createDatabase } from "./db.js"; // removed: SQLite createDatabase no longer exists
// import type { Database } from "./db.js"; // removed: use Db from @agi/db-schema/client
import { EntityStore } from "./store.js";

let db: Database;
let store: EntityStore;

beforeEach(() => {
  db = createDatabase(":memory:");
  store = new EntityStore(db);
});

// ---------------------------------------------------------------------------
// Entity CRUD
// ---------------------------------------------------------------------------

describe.skip("EntityStore.createEntity", () => {
  it("creates entity with ULID id", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    expect(entity.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("sets correct type and displayName", () => {
    const entity = store.createEntity({ type: "O", displayName: "Civicognita" });
    expect(entity.type).toBe("O");
    expect(entity.displayName).toBe("Civicognita");
  });

  it("sets verificationTier to 'unverified'", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    expect(entity.verificationTier).toBe("unverified");
  });

  it("sets ISO-8601 timestamps", () => {
    const before = new Date().toISOString();
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const after = new Date().toISOString();
    expect(entity.createdAt >= before).toBe(true);
    expect(entity.createdAt <= after).toBe(true);
    expect(entity.updatedAt >= before).toBe(true);
    expect(entity.updatedAt <= after).toBe(true);
  });

  it("createdAt and updatedAt are equal on creation", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    expect(entity.createdAt).toBe(entity.updatedAt);
  });

  it("auto-generates coaAlias as #<type><index>", () => {
    const e0 = store.createEntity({ type: "E", displayName: "First" });
    const e1 = store.createEntity({ type: "E", displayName: "Second" });
    const o0 = store.createEntity({ type: "O", displayName: "Org" });

    expect(e0.coaAlias).toBe("#E0");
    expect(e1.coaAlias).toBe("#E1");
    expect(o0.coaAlias).toBe("#O0");
  });

  it("coaAlias is persisted and returned by getEntity", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const fetched = store.getEntity(entity.id);
    expect(fetched!.coaAlias).toBe("#E0");
  });
});

describe.skip("EntityStore.getEntity", () => {
  it("returns entity by id", () => {
    const created = store.createEntity({ type: "E", displayName: "Bob" });
    const fetched = store.getEntity(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.displayName).toBe("Bob");
  });

  it("returns null for non-existent id", () => {
    const result = store.getEntity("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(result).toBeNull();
  });
});

describe.skip("EntityStore.updateEntity", () => {
  it("updates displayName only", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const updated = store.updateEntity(entity.id, { displayName: "Alicia" });
    expect(updated.displayName).toBe("Alicia");
    expect(updated.verificationTier).toBe("unverified");
  });

  it("updates verificationTier only", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const updated = store.updateEntity(entity.id, { verificationTier: "verified" });
    expect(updated.verificationTier).toBe("verified");
    expect(updated.displayName).toBe("Alice");
  });

  it("updates both displayName and verificationTier", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const updated = store.updateEntity(entity.id, {
      displayName: "Alicia",
      verificationTier: "sealed",
    });
    expect(updated.displayName).toBe("Alicia");
    expect(updated.verificationTier).toBe("sealed");
  });

  it("bumps updatedAt after update", async () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    // Tiny delay to ensure time difference
    await new Promise((r) => setTimeout(r, 5));
    const updated = store.updateEntity(entity.id, { displayName: "Alicia" });
    expect(updated.updatedAt >= entity.updatedAt).toBe(true);
  });

  it("throws for non-existent entity id", () => {
    expect(() =>
      store.updateEntity("01ARZ3NDEKTSV4RRFFQ69G5FAV", { displayName: "Ghost" })
    ).toThrow(/not found/i);
  });
});

describe.skip("EntityStore.listEntities", () => {
  it("returns all entities ordered by created_at DESC", async () => {
    const a = store.createEntity({ type: "E", displayName: "Alpha" });
    await new Promise((r) => setTimeout(r, 5));
    const b = store.createEntity({ type: "E", displayName: "Beta" });
    await new Promise((r) => setTimeout(r, 5));
    const c = store.createEntity({ type: "E", displayName: "Gamma" });

    const list = store.listEntities();
    expect(list.length).toBe(3);
    // DESC order: newest first
    expect(list[0]!.id).toBe(c.id);
    expect(list[1]!.id).toBe(b.id);
    expect(list[2]!.id).toBe(a.id);
  });

  it("filters by type", () => {
    store.createEntity({ type: "E", displayName: "Person" });
    store.createEntity({ type: "O", displayName: "Org" });
    store.createEntity({ type: "E", displayName: "Person2" });

    const persons = store.listEntities({ type: "E" });
    expect(persons.length).toBe(2);
    expect(persons.every((e) => e.type === "E")).toBe(true);

    const orgs = store.listEntities({ type: "O" });
    expect(orgs.length).toBe(1);
    expect(orgs[0]!.type).toBe("O");
  });

  it("returns empty array when no entities match filter", () => {
    store.createEntity({ type: "E", displayName: "Person" });
    const teams = store.listEntities({ type: "T" });
    expect(teams).toEqual([]);
  });

  it("pagination with limit and offset works", () => {
    for (let i = 0; i < 5; i++) {
      store.createEntity({ type: "E", displayName: `Entity${i}` });
    }
    const page1 = store.listEntities({ limit: 2, offset: 0 });
    const page2 = store.listEntities({ limit: 2, offset: 2 });
    const page3 = store.listEntities({ limit: 2, offset: 4 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page3.length).toBe(1);

    // No overlap between pages
    const ids = [...page1, ...page2, ...page3].map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("returns empty array when DB is empty", () => {
    expect(store.listEntities()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Channel accounts
// ---------------------------------------------------------------------------

describe.skip("EntityStore.linkChannelAccount", () => {
  it("links channel account and returns ChannelAccount with ULID", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const account = store.linkChannelAccount({
      entityId: entity.id,
      channel: "telegram",
      channelUserId: "12345",
    });

    expect(account.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(account.entityId).toBe(entity.id);
    expect(account.channel).toBe("telegram");
    expect(account.channelUserId).toBe("12345");
  });

  it("throws on duplicate (channel, channelUserId) pair", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    store.linkChannelAccount({
      entityId: entity.id,
      channel: "telegram",
      channelUserId: "12345",
    });

    expect(() =>
      store.linkChannelAccount({
        entityId: entity.id,
        channel: "telegram",
        channelUserId: "12345",
      })
    ).toThrow();
  });

  it("allows same channelUserId on different channels", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    expect(() => {
      store.linkChannelAccount({ entityId: entity.id, channel: "telegram", channelUserId: "99" });
      store.linkChannelAccount({ entityId: entity.id, channel: "discord", channelUserId: "99" });
    }).not.toThrow();
  });
});

describe.skip("EntityStore.getChannelAccounts", () => {
  it("returns all accounts for entity, ordered by created_at ASC", async () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const a1 = store.linkChannelAccount({
      entityId: entity.id,
      channel: "telegram",
      channelUserId: "111",
    });
    await new Promise((r) => setTimeout(r, 5));
    const a2 = store.linkChannelAccount({
      entityId: entity.id,
      channel: "discord",
      channelUserId: "222",
    });

    const accounts = store.getChannelAccounts(entity.id);
    expect(accounts.length).toBe(2);
    // ASC order: oldest first
    expect(accounts[0]!.id).toBe(a1.id);
    expect(accounts[1]!.id).toBe(a2.id);
  });

  it("returns empty array for entity with no accounts", () => {
    const entity = store.createEntity({ type: "E", displayName: "Lonely" });
    expect(store.getChannelAccounts(entity.id)).toEqual([]);
  });

  it("only returns accounts for the given entity", () => {
    const alice = store.createEntity({ type: "E", displayName: "Alice" });
    const bob = store.createEntity({ type: "E", displayName: "Bob" });
    store.linkChannelAccount({ entityId: alice.id, channel: "telegram", channelUserId: "AAA" });
    store.linkChannelAccount({ entityId: bob.id, channel: "telegram", channelUserId: "BBB" });

    expect(store.getChannelAccounts(alice.id).length).toBe(1);
    expect(store.getChannelAccounts(bob.id).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Entity by channel
// ---------------------------------------------------------------------------

describe.skip("EntityStore.getEntityByChannel", () => {
  it("returns entity linked via channel account", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    store.linkChannelAccount({ entityId: entity.id, channel: "telegram", channelUserId: "999" });

    const found = store.getEntityByChannel("telegram", "999");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entity.id);
  });

  it("returns null if not found", () => {
    const result = store.getEntityByChannel("telegram", "does-not-exist");
    expect(result).toBeNull();
  });
});

describe.skip("EntityStore.resolveEntityByChannel", () => {
  it("returns entity linked via channel account", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    store.linkChannelAccount({ entityId: entity.id, channel: "discord", channelUserId: "XYZ" });

    const found = store.resolveEntityByChannel("discord", "XYZ");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entity.id);
  });

  it("returns null if not found", () => {
    expect(store.resolveEntityByChannel("discord", "missing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

describe.skip("EntityStore.resolveOrCreate", () => {
  it("creates new entity and link on first call", () => {
    const entity = store.resolveOrCreate("telegram", "12345", "Alice");
    expect(entity.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(entity.displayName).toBe("Alice");
    expect(entity.type).toBe("E");
  });

  it("returns existing entity on second call with same (channel, channelUserId)", () => {
    const first = store.resolveOrCreate("telegram", "12345", "Alice");
    const second = store.resolveOrCreate("telegram", "12345", "AliceDuplicate");
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe("Alice");
  });

  it("defaults type to 'E' when not provided", () => {
    const entity = store.resolveOrCreate("telegram", "99999");
    expect(entity.type).toBe("E");
  });

  it("defaults displayName to 'Unknown' when not provided", () => {
    const entity = store.resolveOrCreate("telegram", "99999");
    expect(entity.displayName).toBe("Unknown");
  });

  it("links channel account so getEntityByChannel finds it", () => {
    const entity = store.resolveOrCreate("telegram", "77777", "Charlie");
    const found = store.getEntityByChannel("telegram", "77777");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entity.id);
  });
});
