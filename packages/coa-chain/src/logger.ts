import { createHash } from "node:crypto";
import { and, eq, asc, sql } from "drizzle-orm";

import type { Db } from "@agi/db-schema/client";
import { coaChains } from "@agi/db-schema";
import type { COAWorkType } from "./types.js";
import { formatFingerprint } from "./format.js";

export interface LogEntryParams {
  resourceId: string; // $A0
  entityId: string; // ULID — stored in DB for FK integrity
  /** COA alias for fingerprint notation (e.g. "#E0"). If omitted, entityId is used. */
  entityAlias?: string;
  nodeId: string; // @A0
  workType: COAWorkType; // "message_in", "tool_use", etc.
  ref?: string; // reference to related object
  action?: "create" | "update" | "delete";
  payloadHash?: string; // SHA-256 of payload
  /** Dev mode fork identifier (e.g. "wishborn/aionima"). Null in production. */
  forkId?: string;
  /** Source IP address of the request (compliance: HIPAA audit controls, PCI Req 10). */
  sourceIp?: string;
}

export interface COAChainRow {
  fingerprint: string;
  resourceId: string;
  entityId: string;
  nodeId: string;
  chainCounter: number;
  workType: string;
  ref: string | null;
  action: string | null;
  payloadHash: string | null;
  forkId: string | null;
  sourceIp: string | null;
  integrityHash: string | null;
  createdAt: string;
}

function buildChainSegment(counter: number): string {
  return `C${String(counter).padStart(3, "0")}`;
}

function rowToCOAChainRow(row: typeof coaChains.$inferSelect): COAChainRow {
  return {
    fingerprint: row.fingerprint,
    resourceId: row.resourceId,
    entityId: row.entityId,
    nodeId: row.nodeId,
    chainCounter: row.chainCounter,
    workType: row.workType,
    ref: row.ref ?? null,
    action: row.action ?? null,
    payloadHash: row.payloadHash ?? null,
    forkId: row.forkId ?? null,
    sourceIp: row.sourceIp ?? null,
    integrityHash: row.integrityHash ?? null,
    // Convert Date to ISO string to preserve existing string contract
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export class COAChainLogger {
  private lastIntegrityHash = "";

  constructor(private readonly db: Db) {}

  /**
   * Log a new COA record atomically.
   *
   * Reads MAX(chain_counter) for the (resource_id, entity_id) pair and inserts
   * with counter+1 inside a single transaction, preventing counter collisions
   * under concurrent writes.
   *
   * @returns The fingerprint string for the newly inserted record.
   */
  async log(params: LogEntryParams): Promise<string> {
    const {
      resourceId,
      entityId,
      entityAlias,
      nodeId,
      workType,
      ref,
      action,
      payloadHash,
      forkId,
      sourceIp,
    } = params;

    // Use the human-readable alias for fingerprint notation, falling back to
    // entityId when no alias is provided (backwards-compatible).
    const fingerprintEntity = entityAlias ?? entityId;

    const fingerprint = await this.db.transaction(async (tx) => {
      const [maxRow] = await tx
        .select({ maxCounter: sql<number>`COALESCE(MAX(${coaChains.chainCounter}), 0)` })
        .from(coaChains)
        .where(
          and(
            eq(coaChains.resourceId, resourceId),
            eq(coaChains.entityId, entityId),
          ),
        );

      const nextCounter = (maxRow?.maxCounter ?? 0) + 1;
      const chainSegment = buildChainSegment(nextCounter);
      const fp = formatFingerprint({
        resource: resourceId,
        entity: fingerprintEntity,
        node: nodeId,
        chain: chainSegment,
      });

      const createdAt = new Date();

      // Compute HMAC integrity chain: hash(entry fields + previous hash)
      const entryData = `${fp}|${resourceId}|${entityId}|${nodeId}|${String(nextCounter)}|${workType}|${ref ?? ""}|${action ?? ""}|${payloadHash ?? ""}|${sourceIp ?? ""}|${createdAt.toISOString()}|${this.lastIntegrityHash}`;
      const integrityHash = createHash("sha256").update(entryData).digest("hex");
      this.lastIntegrityHash = integrityHash;

      await tx.insert(coaChains).values({
        fingerprint: fp,
        resourceId,
        entityId,
        nodeId,
        chainCounter: nextCounter,
        workType,
        ref: ref ?? null,
        action: action ?? null,
        payloadHash: payloadHash ?? null,
        forkId: forkId ?? null,
        sourceIp: sourceIp ?? null,
        integrityHash,
        createdAt,
      });

      return fp;
    });

    return fingerprint;
  }

  /**
   * Get the latest chain counter for an entity on a resource.
   * Returns 0 if no records exist yet.
   */
  async getLatestCounter(resourceId: string, entityId: string): Promise<number> {
    const [row] = await this.db
      .select({ maxCounter: sql<number>`COALESCE(MAX(${coaChains.chainCounter}), 0)` })
      .from(coaChains)
      .where(
        and(
          eq(coaChains.resourceId, resourceId),
          eq(coaChains.entityId, entityId),
        ),
      );
    return row?.maxCounter ?? 0;
  }

  /**
   * Get all chain records for an entity, ordered by chain_counter ascending.
   */
  async getChain(
    entityId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<COAChainRow[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const rows = await this.db
      .select()
      .from(coaChains)
      .where(eq(coaChains.entityId, entityId))
      .orderBy(asc(coaChains.chainCounter))
      .limit(limit)
      .offset(offset);

    return rows.map(rowToCOAChainRow);
  }

  /**
   * Get a single record by its fingerprint string.
   * Returns null if not found.
   */
  async getRecord(fingerprint: string): Promise<COAChainRow | null> {
    const [row] = await this.db
      .select()
      .from(coaChains)
      .where(eq(coaChains.fingerprint, fingerprint));

    return row ? rowToCOAChainRow(row) : null;
  }
}
