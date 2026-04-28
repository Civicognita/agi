/**
 * MagicAppStateStore — Postgres/drizzle persistence for open MagicApp instances.
 *
 * State survives browser close, AGI crash, and connection loss.
 * Destroyed only on explicit close (user or app-triggered).
 */

import { eq, desc } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import { magicAppInstances } from "@agi/db-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MagicAppInstanceRecord {
  instanceId: string;
  appId: string;
  userEntityId: string;
  projectPath: string;
  mode: "floating" | "docked" | "minimized" | "maximized";
  state: Record<string, unknown>;
  position: { x: number; y: number; width: number; height: number } | null;
  openedAt: string;
  updatedAt: string;
}

export interface CreateInstanceParams {
  instanceId: string;
  appId: string;
  userEntityId: string;
  projectPath: string;
  mode?: "floating" | "docked" | "minimized" | "maximized";
  state?: Record<string, unknown>;
  position?: { x: number; y: number; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToRecord(row: typeof magicAppInstances.$inferSelect): MagicAppInstanceRecord {
  return {
    instanceId: row.instanceId,
    appId: row.appId,
    userEntityId: row.userEntityId,
    projectPath: row.projectPath ?? "",
    mode: row.mode as MagicAppInstanceRecord["mode"],
    state: (row.state ?? {}) as Record<string, unknown>,
    position: row.position as { x: number; y: number; width: number; height: number } | null,
    openedAt: row.openedAt instanceof Date ? row.openedAt.toISOString() : String(row.openedAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class MagicAppStateStore {
  constructor(private readonly db: Db) {}

  /** List all open instances for a user. */
  async listInstances(userEntityId: string): Promise<MagicAppInstanceRecord[]> {
    const rows = await this.db
      .select()
      .from(magicAppInstances)
      .where(eq(magicAppInstances.userEntityId, userEntityId))
      .orderBy(desc(magicAppInstances.openedAt));
    return rows.map(rowToRecord);
  }

  /** Get a single instance by ID. */
  async getInstance(instanceId: string): Promise<MagicAppInstanceRecord | null> {
    const [row] = await this.db
      .select()
      .from(magicAppInstances)
      .where(eq(magicAppInstances.instanceId, instanceId));
    return row ? rowToRecord(row) : null;
  }

  /** Create a new instance. */
  async createInstance(params: CreateInstanceParams): Promise<MagicAppInstanceRecord> {
    const now = new Date();
    await this.db.insert(magicAppInstances).values({
      instanceId: params.instanceId,
      appId: params.appId,
      userEntityId: params.userEntityId,
      projectPath: params.projectPath,
      mode: (params.mode ?? "floating") as typeof magicAppInstances.$inferInsert["mode"],
      state: (params.state ?? {}) as Record<string, unknown>,
      position: (params.position ?? null) as Record<string, unknown> | null,
      openedAt: now,
      updatedAt: now,
    });
    return (await this.getInstance(params.instanceId))!;
  }

  /** Update instance state (JSON blob). */
  async updateState(instanceId: string, state: Record<string, unknown>): Promise<void> {
    await this.db
      .update(magicAppInstances)
      .set({ state: state as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(magicAppInstances.instanceId, instanceId));
  }

  /** Update instance mode. */
  async updateMode(instanceId: string, mode: "floating" | "docked" | "minimized" | "maximized"): Promise<void> {
    await this.db
      .update(magicAppInstances)
      .set({ mode: mode as typeof magicAppInstances.$inferInsert["mode"], updatedAt: new Date() })
      .where(eq(magicAppInstances.instanceId, instanceId));
  }

  /** Update instance position (for floating mode). */
  async updatePosition(
    instanceId: string,
    position: { x: number; y: number; width: number; height: number },
  ): Promise<void> {
    await this.db
      .update(magicAppInstances)
      .set({ position: position as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(magicAppInstances.instanceId, instanceId));
  }

  /** Close and destroy an instance. */
  async deleteInstance(instanceId: string): Promise<void> {
    await this.db
      .delete(magicAppInstances)
      .where(eq(magicAppInstances.instanceId, instanceId));
  }
}
