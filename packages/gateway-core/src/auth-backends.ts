/**
 * Auth backends for the AGI gateway.
 *
 * Provides virtual (username + password) authentication against the unified
 * `users` table in agi_data. Passwords are argon2id hashes, consistent with
 * what local-ID produced before the merger.
 *
 * PAM backend is a no-op placeholder — wire in when needed.
 */

import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { eq, or } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import { users } from "@agi/db-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthDbUser {
  id: string;
  username: string | null;
  displayName: string | null;
  dashboardRole: string;
  entityId: string | null;
  createdAt: string;
}

export interface AuthenticateResult {
  ok: boolean;
  userId?: string;
  username?: string;
  displayName?: string;
  role?: string;
  entityId?: string;
  reason?: "invalid_credentials" | "no_password" | "disabled";
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

export async function hashUserPassword(password: string): Promise<string> {
  return hash(password);
}

// ---------------------------------------------------------------------------
// Authenticate — argon2 virtual backend
// ---------------------------------------------------------------------------

/**
 * Authenticate a user by principal (username or email) + password.
 * Looks up the `users` table, verifies the argon2id hash.
 */
export async function authenticateDbUser(
  db: Db,
  principal: string,
  password: string,
): Promise<AuthenticateResult> {
  const p = principal.toLowerCase();

  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.principal, p), eq(users.email, p), eq(users.username, p)))
    .limit(1);

  if (!user) return { ok: false, reason: "invalid_credentials" };
  if (!user.passwordHash) return { ok: false, reason: "no_password" };

  const matched = await verify(user.passwordHash, password);
  if (!matched) return { ok: false, reason: "invalid_credentials" };

  return {
    ok: true,
    userId: user.id,
    username: user.username ?? user.principal,
    displayName: user.displayName ?? user.username ?? user.principal,
    role: user.dashboardRole ?? "viewer",
    entityId: user.entityId ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// User CRUD — direct Drizzle operations
// ---------------------------------------------------------------------------

function generateId(): string {
  const ts = Date.now().toString(36).padStart(9, "0");
  const rand = randomBytes(10).toString("hex");
  return `${ts}${rand}`;
}

export async function createDbUser(
  db: Db,
  params: {
    username: string;
    email?: string;
    displayName?: string;
    password: string;
    dashboardRole?: string;
  },
): Promise<AuthDbUser> {
  const id = generateId();
  const passwordHash = await hashUserPassword(params.password);
  const principal = (params.username ?? params.email ?? "").toLowerCase();

  const [user] = await db
    .insert(users)
    .values({
      id,
      authBackend: "virtual",
      principal,
      username: params.username,
      email: params.email,
      displayName: params.displayName ?? params.username,
      passwordHash,
      // dashboardRoleEnum accepts: viewer | editor | admin | owner
      dashboardRole:
        (params.dashboardRole as "viewer" | "editor" | "admin" | "owner" | undefined) ?? "viewer",
    })
    .returning();

  if (!user) throw new Error("Failed to create user");
  return toPublicUser(user);
}

export async function listDbUsers(db: Db): Promise<AuthDbUser[]> {
  const rows = await db.select().from(users);
  return rows.map(toPublicUser);
}

export async function getDbUser(db: Db, id: string): Promise<AuthDbUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ? toPublicUser(user) : null;
}

export async function updateDbUser(
  db: Db,
  id: string,
  params: { displayName?: string; dashboardRole?: string; disabled?: boolean },
): Promise<AuthDbUser | null> {
  const updates: Partial<typeof users.$inferInsert> = {};
  if (params.displayName !== undefined) updates.displayName = params.displayName;
  if (params.dashboardRole !== undefined) {
    updates.dashboardRole =
      params.dashboardRole as "viewer" | "editor" | "admin" | "owner";
  }
  // disabled: map to verificationTier = "disabled" via entities table in Phase 3;
  // for now just a no-op to keep the API stable
  if (Object.keys(updates).length === 0) {
    const existing = await getDbUser(db, id);
    return existing;
  }
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning();

  return updated ? toPublicUser(updated) : null;
}

export async function deleteDbUser(db: Db, id: string): Promise<boolean> {
  const result = await db.delete(users).where(eq(users.id, id));
  return (result.rowCount ?? 0) > 0;
}

export async function changeDbUserPassword(
  db: Db,
  id: string,
  newPassword: string,
): Promise<boolean> {
  const passwordHash = await hashUserPassword(newPassword);
  const result = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, id));
  return (result.rowCount ?? 0) > 0;
}

export async function countDbUsers(db: Db): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPublicUser(user: typeof users.$inferSelect): AuthDbUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    dashboardRole: user.dashboardRole ?? "viewer",
    entityId: user.entityId,
    createdAt: user.createdAt.toISOString(),
  };
}
