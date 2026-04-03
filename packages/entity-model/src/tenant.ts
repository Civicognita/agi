/**
 * Multi-Tenancy Types — Task #188/#189
 *
 * Tenant isolation primitives for hosted multi-user mode.
 * In self-hosted (SQLite) mode, tenantId is always the constant DEFAULT_TENANT.
 */

import { ulid } from "ulid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Unique tenant identifier (ULID). */
export type TenantId = string & { readonly __brand: unique symbol };

/** Billing plan tiers. */
export type PlanTier = "free" | "pro" | "org" | "community";

/** Tenant record — one per customer/deployment. */
export interface Tenant {
  id: TenantId;
  name: string;
  plan: PlanTier;
  ownerId: string; // Entity ID of the account owner (#E)
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  maxEntities: number;
  maxChannels: number;
  maxMonthlyMessages: number;
  createdAt: string;
  updatedAt: string;
}

/** Plan limits by tier. */
export interface PlanLimits {
  maxEntities: number;
  maxChannels: number;
  maxMonthlyMessages: number;
  maxConcurrentSessions: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default tenant ID for self-hosted (single-tenant SQLite) mode. */
export const DEFAULT_TENANT = "00000000000000000000000000" as TenantId;

/** Plan limits per tier. */
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxEntities: 5,
    maxChannels: 2,
    maxMonthlyMessages: 1_000,
    maxConcurrentSessions: 1,
  },
  pro: {
    maxEntities: 50,
    maxChannels: 10,
    maxMonthlyMessages: 50_000,
    maxConcurrentSessions: 5,
  },
  org: {
    maxEntities: 500,
    maxChannels: 25,
    maxMonthlyMessages: 500_000,
    maxConcurrentSessions: 20,
  },
  community: {
    maxEntities: 10_000,
    maxChannels: 50,
    maxMonthlyMessages: 5_000_000,
    maxConcurrentSessions: 100,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a new tenant ID. */
export function createTenantId(): TenantId {
  return ulid() as TenantId;
}

/** Get plan limits for a given tier. */
export function getPlanLimits(plan: PlanTier): PlanLimits {
  return PLAN_LIMITS[plan];
}

/** Check if a tenant has exceeded their entity limit. */
export function isOverEntityLimit(tenant: Tenant, currentCount: number): boolean {
  return currentCount >= tenant.maxEntities;
}

/** Check if a tenant has exceeded their channel limit. */
export function isOverChannelLimit(tenant: Tenant, currentCount: number): boolean {
  return currentCount >= tenant.maxChannels;
}
