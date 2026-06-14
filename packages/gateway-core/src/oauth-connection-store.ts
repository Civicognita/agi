/**
 * OAuth connection store — single source of truth for persisting OAuth tokens
 * to the `connections` table (story #213).
 *
 * Both OAuth ingress paths use these helpers so they can't drift:
 *   - device-flow-api.ts  (RFC 8628 device grant — GitHub)
 *   - identity-api.ts      (redirect authorization-code — Google/Meta/X/Tynn)
 *
 * Tokens are encrypted at the app layer (crypto-tokens) before they touch the DB.
 */

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { connections, users } from "@agi/db-schema";
import type { Db } from "@agi/db-schema/client";
import { encryptToken } from "./crypto-tokens.js";

/**
 * Resolve the local owner user row (the FK target for connections), creating a
 * minimal virtual owner if the node has no users yet. `accountLabelHint` seeds
 * the display name / principal of a freshly-created owner.
 */
export async function resolveOrCreateOwnerUserId(db: Db, accountLabelHint?: string): Promise<string> {
  const [firstUser] = await db.select({ id: users.id }).from(users).limit(1);
  if (firstUser) return firstUser.id;

  const principal = (accountLabelHint?.toLowerCase() || "owner").replace(/[^a-z0-9_-]/g, "") || "owner";
  const id = randomBytes(16).toString("hex");
  try {
    await db.insert(users).values({
      id,
      authBackend: "virtual",
      principal,
      username: principal,
      displayName: accountLabelHint || "Owner",
      dashboardRole: "admin",
    });
  } catch {
    // Race / unique conflict — re-read whatever landed.
    const [again] = await db.select({ id: users.id }).from(users).limit(1);
    return again?.id ?? id;
  }
  return id;
}

export interface UpsertConnectionParams {
  provider: string;
  role: string;
  accountLabel: string | null;
  /** Plaintext access token — encrypted here before persistence. */
  accessToken: string;
  /** Plaintext refresh token — encrypted here; null when the provider issues none. */
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes?: string | null;
}

/**
 * Insert or update the connection row keyed by (userId, provider, role). Access
 * and refresh tokens are encrypted with `encKey` before they are written.
 */
export async function upsertConnection(
  db: Db,
  encKey: Buffer,
  userId: string,
  params: UpsertConnectionParams,
): Promise<void> {
  const now = new Date();
  const values = {
    accountLabel: params.accountLabel,
    accessToken: encryptToken(encKey, params.accessToken),
    refreshToken: params.refreshToken ? encryptToken(encKey, params.refreshToken) : null,
    tokenExpiresAt: params.tokenExpiresAt ?? null,
    scopes: params.scopes ?? null,
    updatedAt: now,
  };

  const [existing] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.userId, userId), eq(connections.provider, params.provider), eq(connections.role, params.role)))
    .limit(1);

  if (existing) {
    await db.update(connections).set(values).where(eq(connections.id, existing.id));
  } else {
    await db.insert(connections).values({
      id: randomBytes(16).toString("hex"),
      userId,
      provider: params.provider,
      role: params.role,
      createdAt: now,
      ...values,
    });
  }
}
