/**
 * Authentication + identity tables.
 *
 * Consolidates Local-ID's standalone auth tables into the unified agi_data
 * schema. Notable decisions:
 *
 * - `users.password_hash` is retained permanently to support **virtual users**
 *   (family members, teammates on a local AGI setup). Phase 3 adds
 *   `auth_backend` + `principal` columns so system-backed accounts (PAM, LDAP,
 *   Active Directory) can coexist with virtual accounts. Virtual accounts
 *   continue to authenticate via `password_hash`.
 * - `auth_sessions` = active web auth cookies (short-lived).
 *   Separate `revocation_audit` table in `./audit.ts` keeps the SOC 2 CC6
 *   compliance trail.
 * - `connections` = OAuth tokens per user+provider (GitHub, Google, Discord).
 *   `handoffs` = short-lived state for device/delegation flows.
 */

import { pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { entities } from "./entities.js";

/** Authentication backend selector. `virtual` uses password_hash; others delegate. */
export const authBackendEnum = pgEnum("auth_backend", [
  "virtual",
  "pam",
  "ldap",
  "ad",
]);

/** Dashboard role assigned to a user. */
export const dashboardRoleEnum = pgEnum("dashboard_role", [
  "viewer",
  "editor",
  "admin",
  "owner",
]);

/**
 * User account — one row per principal on this AGI install.
 *
 * `(auth_backend, principal)` is unique. For virtual users, `principal` is the
 * self-chosen username and `password_hash` is populated. For system-backed
 * users, `principal` is the backend identifier (system username, LDAP DN,
 * etc.) and `password_hash` stays NULL.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    authBackend: authBackendEnum("auth_backend").notNull().default("virtual"),
    principal: text("principal").notNull(),
    email: text("email"),
    username: text("username"),
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    entityId: text("entity_id").references(() => entities.id),
    dashboardRole: dashboardRoleEnum("dashboard_role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    backendPrincipalIdx: uniqueIndex("users_backend_principal_idx").on(
      t.authBackend,
      t.principal,
    ),
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    usernameIdx: uniqueIndex("users_username_idx").on(t.username),
  }),
);

/**
 * Web auth session — cookie-backed active session. Row deletes on expiry/logout.
 * Compliance audit trail lives in `revocation_audit` (audit.ts), not here.
 */
export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * API key — long-lived programmatic access. Hash-only storage; plaintext is
 * shown to the creator once and never persisted.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull().default(""),
    keyHash: text("key_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    keyHashIdx: uniqueIndex("api_keys_key_hash_idx").on(t.keyHash),
  }),
);

/**
 * OAuth connection — stored tokens per user+provider+role. Tokens are
 * encrypted at the application layer before insert.
 */
export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    role: text("role").notNull(),
    accountLabel: text("account_label"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    /**
     * For proxied providers (Plaid, Google, Discord per s149 cycle 215):
     * encrypted DToken (delegation token) instead of holding the raw
     * provider access_token. The DToken is bound to a connection at
     * Hive-ID; Local-ID forwards it as a Bearer credential to Hive-ID's
     * proxy gateway. Public-client providers (GitHub device flow) still
     * use accessToken for the raw token.
     *
     * NULL for public-client providers (GitHub) and pre-s149 connections.
     */
    dtoken: text("dtoken"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userProviderRoleIdx: uniqueIndex("connections_user_provider_role_idx").on(
      t.userId,
      t.provider,
      t.role,
    ),
  }),
);

/**
 * Handoff / delegation flow state — short-lived rows for device flow, OAuth
 * redirect, SSO handoff, etc. Rows deleted on completion or expiry.
 */
export const handoffs = pgTable("handoffs", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  purpose: text("purpose").notNull().default("onboarding"),
  connectedServices: text("connected_services"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
