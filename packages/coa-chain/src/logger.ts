import { createHash } from "node:crypto";
import type { Database, Statement } from "better-sqlite3";

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

/** Raw row shape returned by better-sqlite3 */
interface RawChainRow {
  fingerprint: string;
  resource_id: string;
  entity_id: string;
  node_id: string;
  chain_counter: number;
  work_type: string;
  ref: string | null;
  action: string | null;
  payload_hash: string | null;
  fork_id: string | null;
  source_ip: string | null;
  integrity_hash: string | null;
  created_at: string;
}

function toChainRow(raw: RawChainRow): COAChainRow {
  return {
    fingerprint: raw.fingerprint,
    resourceId: raw.resource_id,
    entityId: raw.entity_id,
    nodeId: raw.node_id,
    chainCounter: raw.chain_counter,
    workType: raw.work_type,
    ref: raw.ref,
    action: raw.action,
    payloadHash: raw.payload_hash,
    forkId: raw.fork_id,
    sourceIp: raw.source_ip,
    integrityHash: raw.integrity_hash,
    createdAt: raw.created_at,
  };
}

function buildChainSegment(counter: number): string {
  return `C${String(counter).padStart(3, "0")}`;
}

export class COAChainLogger {
  private readonly stmtInsert: Statement;
  private readonly stmtMaxCounter: Statement<[string, string]>;
  private readonly stmtGetChain: Statement<[string, number, number]>;
  private readonly stmtGetRecord: Statement<[string]>;

  private lastIntegrityHash = "";

  constructor(private db: Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO coa_chains (
        fingerprint,
        resource_id,
        entity_id,
        node_id,
        chain_counter,
        work_type,
        ref,
        action,
        payload_hash,
        fork_id,
        source_ip,
        integrity_hash,
        created_at
      ) VALUES (
        @fingerprint,
        @resource_id,
        @entity_id,
        @node_id,
        @chain_counter,
        @work_type,
        @ref,
        @action,
        @payload_hash,
        @fork_id,
        @source_ip,
        @integrity_hash,
        @created_at
      )
    `);

    this.stmtMaxCounter = db.prepare(`
      SELECT COALESCE(MAX(chain_counter), 0) AS max_counter
      FROM coa_chains
      WHERE resource_id = ? AND entity_id = ?
    `);

    this.stmtGetChain = db.prepare(`
      SELECT
        fingerprint,
        resource_id,
        entity_id,
        node_id,
        chain_counter,
        work_type,
        ref,
        action,
        payload_hash,
        fork_id,
        source_ip,
        integrity_hash,
        created_at
      FROM coa_chains
      WHERE entity_id = ?
      ORDER BY chain_counter ASC
      LIMIT ? OFFSET ?
    `);

    this.stmtGetRecord = db.prepare(`
      SELECT
        fingerprint,
        resource_id,
        entity_id,
        node_id,
        chain_counter,
        work_type,
        ref,
        action,
        payload_hash,
        fork_id,
        source_ip,
        integrity_hash,
        created_at
      FROM coa_chains
      WHERE fingerprint = ?
    `);
  }

  /**
   * Log a new COA record atomically.
   *
   * Reads MAX(chain_counter) for the (resource_id, entity_id) pair and inserts
   * with counter+1 inside a single transaction, preventing counter collisions
   * under concurrent writes.
   *
   * @returns The fingerprint string for the newly inserted record.
   */
  log(params: LogEntryParams): string {
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

    const insertAtomic = this.db.transaction(() => {
      const maxRow = this.stmtMaxCounter.get(resourceId, entityId) as {
        max_counter: number;
      };
      const nextCounter = maxRow.max_counter + 1;

      const chainSegment = buildChainSegment(nextCounter);
      const fingerprint = formatFingerprint({
        resource: resourceId,
        entity: fingerprintEntity,
        node: nodeId,
        chain: chainSegment,
      });

      const createdAt = new Date().toISOString();

      // Compute HMAC integrity chain: hash(entry fields + previous hash)
      const entryData = `${fingerprint}|${resourceId}|${entityId}|${nodeId}|${String(nextCounter)}|${workType}|${ref ?? ""}|${action ?? ""}|${payloadHash ?? ""}|${sourceIp ?? ""}|${createdAt}|${this.lastIntegrityHash}`;
      const integrityHash = createHash("sha256").update(entryData).digest("hex");
      this.lastIntegrityHash = integrityHash;

      this.stmtInsert.run({
        fingerprint,
        resource_id: resourceId,
        entity_id: entityId,
        node_id: nodeId,
        chain_counter: nextCounter,
        work_type: workType,
        ref: ref ?? null,
        action: action ?? null,
        payload_hash: payloadHash ?? null,
        fork_id: forkId ?? null,
        source_ip: sourceIp ?? null,
        integrity_hash: integrityHash,
        created_at: createdAt,
      });

      return fingerprint;
    });

    return insertAtomic() as string;
  }

  /**
   * Get the latest chain counter for an entity on a resource.
   * Returns 0 if no records exist yet.
   */
  getLatestCounter(resourceId: string, entityId: string): number {
    const row = this.stmtMaxCounter.get(resourceId, entityId) as {
      max_counter: number;
    };
    return row.max_counter;
  }

  /**
   * Get all chain records for an entity, ordered by chain_counter ascending.
   */
  getChain(
    entityId: string,
    opts?: { limit?: number; offset?: number }
  ): COAChainRow[] {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const rows = this.stmtGetChain.all(entityId, limit, offset) as RawChainRow[];
    return rows.map(toChainRow);
  }

  /**
   * Get a single record by its fingerprint string.
   * Returns null if not found.
   */
  getRecord(fingerprint: string): COAChainRow | null {
    const row = this.stmtGetRecord.get(fingerprint) as RawChainRow | undefined;
    return row ? toChainRow(row) : null;
  }
}
