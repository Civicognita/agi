import { describe, expect, it } from "vitest";
import { connections, users } from "@agi/db-schema";
import type { Db } from "@agi/db-schema/client";
import { decryptToken } from "./crypto-tokens.js";
import { resolveOrCreateOwnerUserId, upsertConnection } from "./oauth-connection-store.js";

const ENC_KEY = Buffer.alloc(32, 7);

/** Minimal drizzle fake supporting select().from().where().limit(), insert().values(), update().set().where(). */
function makeFakeDb(seed: { users?: Array<{ id: string }>; connections?: Array<{ id: string }> } = {}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    users: [...(seed.users ?? [])],
    connections: [...(seed.connections ?? [])],
  };
  const captured = {
    insertedUsers: [] as Array<Record<string, unknown>>,
    insertedConnections: [] as Array<Record<string, unknown>>,
    updatedConnections: [] as Array<Record<string, unknown>>,
  };
  const nameOf = (t: unknown) => (t === users ? "users" : t === connections ? "connections" : "unknown");

  const db = {
    select() {
      return {
        from(t: unknown) {
          const rows = tables[nameOf(t)]!;
          const builder = {
            where() { return builder; },
            limit() { return Promise.resolve(rows.slice(0, 1)); },
          };
          return builder;
        },
      };
    },
    insert(t: unknown) {
      const name = nameOf(t);
      return {
        values(v: Record<string, unknown>) {
          tables[name]!.push(v);
          (name === "users" ? captured.insertedUsers : captured.insertedConnections).push(v);
          return Promise.resolve();
        },
      };
    },
    update(_t: unknown) {
      return {
        set(v: Record<string, unknown>) {
          return { where() { captured.updatedConnections.push(v); return Promise.resolve(); } };
        },
      };
    },
  };
  return { db: db as unknown as Db, captured };
}

describe("oauth-connection-store (s213 t781)", () => {
  it("resolveOrCreateOwnerUserId returns the existing owner when one exists", async () => {
    const { db, captured } = makeFakeDb({ users: [{ id: "u-existing" }] });
    expect(await resolveOrCreateOwnerUserId(db)).toBe("u-existing");
    expect(captured.insertedUsers).toHaveLength(0);
  });

  it("resolveOrCreateOwnerUserId creates a virtual owner when none exists", async () => {
    const { db, captured } = makeFakeDb({ users: [] });
    const id = await resolveOrCreateOwnerUserId(db, "octocat");
    expect(id).toBeTruthy();
    expect(captured.insertedUsers).toHaveLength(1);
    expect(captured.insertedUsers[0]!.authBackend).toBe("virtual");
    expect(captured.insertedUsers[0]!.displayName).toBe("octocat");
  });

  it("upsertConnection INSERTS (encrypting tokens) when no connection exists", async () => {
    const { db, captured } = makeFakeDb({ connections: [] });
    await upsertConnection(db, ENC_KEY, "u-1", {
      provider: "google",
      role: "owner",
      accountLabel: "a@b.com",
      accessToken: "plain-access",
      refreshToken: "plain-refresh",
      scopes: "email",
    });
    expect(captured.insertedConnections).toHaveLength(1);
    const row = captured.insertedConnections[0]!;
    expect(row.provider).toBe("google");
    expect(row.role).toBe("owner");
    // tokens are stored encrypted, not plaintext
    expect(row.accessToken).not.toBe("plain-access");
    expect(decryptToken(ENC_KEY, row.accessToken as string)).toBe("plain-access");
    expect(decryptToken(ENC_KEY, row.refreshToken as string)).toBe("plain-refresh");
  });

  it("upsertConnection UPDATES when a connection already exists", async () => {
    const { db, captured } = makeFakeDb({ connections: [{ id: "c-1" }] });
    await upsertConnection(db, ENC_KEY, "u-1", {
      provider: "x",
      role: "owner",
      accountLabel: "@ada",
      accessToken: "new-token",
      refreshToken: null,
    });
    expect(captured.insertedConnections).toHaveLength(0);
    expect(captured.updatedConnections).toHaveLength(1);
    expect(decryptToken(ENC_KEY, captured.updatedConnections[0]!.accessToken as string)).toBe("new-token");
    expect(captured.updatedConnections[0]!.refreshToken).toBeNull();
  });
});
