/**
 * Federation Peer Store — SQLite-backed persistent peer storage.
 *
 * Replaces the in-memory Map in FederationNode with durable storage
 * so peers survive restarts.
 */

import type { Database } from "@aionima/entity-model";
import type { PeerNode, DiscoveryMethod, TrustLevel } from "./federation-types.js";

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface PeerRow {
  node_id: string;
  geid: string;
  endpoint: string;
  public_key: string;
  trust_level: number;
  discovery_method: string;
  display_name: string | null;
  last_seen: string;
  last_handshake: string | null;
  failure_count: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToPeer(row: PeerRow): PeerNode {
  return {
    nodeId: row.node_id,
    endpoint: row.endpoint,
    publicKey: row.public_key,
    trustLevel: row.trust_level as TrustLevel,
    discoveryMethod: row.discovery_method as DiscoveryMethod,
    lastSeen: row.last_seen,
    lastHandshake: row.last_handshake,
    failureCount: row.failure_count,
    online: row.failure_count < 5,
  };
}

// ---------------------------------------------------------------------------
// FederationPeerStore
// ---------------------------------------------------------------------------

export class FederationPeerStore {
  private readonly stmtUpsert;
  private readonly stmtGet;
  private readonly stmtGetAll;
  private readonly stmtGetTrusted;
  private readonly stmtDelete;
  private readonly stmtRecordHandshake;
  private readonly stmtIncrementFailure;
  private readonly stmtSetTrust;
  private readonly stmtCount;

  constructor(db: Database) {
    this.stmtUpsert = db.prepare(`
      INSERT INTO federation_peers (node_id, geid, endpoint, public_key, trust_level, discovery_method, display_name, last_seen, last_handshake, failure_count, created_at)
      VALUES (@node_id, @geid, @endpoint, @public_key, @trust_level, @discovery_method, @display_name, @last_seen, @last_handshake, @failure_count, @created_at)
      ON CONFLICT (node_id) DO UPDATE SET
        endpoint = excluded.endpoint,
        public_key = excluded.public_key,
        trust_level = excluded.trust_level,
        display_name = excluded.display_name,
        last_seen = excluded.last_seen
    `);

    this.stmtGet = db.prepare(`SELECT * FROM federation_peers WHERE node_id = ?`);
    this.stmtGetAll = db.prepare(`SELECT * FROM federation_peers ORDER BY last_seen DESC`);
    this.stmtGetTrusted = db.prepare(`SELECT * FROM federation_peers WHERE trust_level >= ? ORDER BY last_seen DESC`);
    this.stmtDelete = db.prepare(`DELETE FROM federation_peers WHERE node_id = ?`);

    this.stmtRecordHandshake = db.prepare(`
      UPDATE federation_peers
      SET trust_level = ?, last_handshake = ?, last_seen = ?, failure_count = 0
      WHERE node_id = ?
    `);

    this.stmtIncrementFailure = db.prepare(`
      UPDATE federation_peers SET failure_count = failure_count + 1 WHERE node_id = ?
    `);

    this.stmtSetTrust = db.prepare(`
      UPDATE federation_peers SET trust_level = ? WHERE node_id = ?
    `);

    this.stmtCount = db.prepare(`SELECT COUNT(*) as count FROM federation_peers`);
  }

  addPeer(
    nodeId: string,
    endpoint: string,
    publicKey: string,
    method: DiscoveryMethod,
    trustLevel: TrustLevel = 0,
    opts?: { geid?: string; displayName?: string },
  ): PeerNode {
    const now = new Date().toISOString();
    this.stmtUpsert.run({
      node_id: nodeId,
      geid: opts?.geid ?? "",
      endpoint,
      public_key: publicKey,
      trust_level: trustLevel,
      discovery_method: method,
      display_name: opts?.displayName ?? null,
      last_seen: now,
      last_handshake: null,
      failure_count: 0,
      created_at: now,
    });

    return {
      nodeId,
      endpoint,
      publicKey,
      trustLevel,
      discoveryMethod: method,
      lastSeen: now,
      lastHandshake: null,
      failureCount: 0,
      online: true,
    };
  }

  getPeer(nodeId: string): PeerNode | null {
    const row = this.stmtGet.get(nodeId) as PeerRow | undefined;
    return row ? rowToPeer(row) : null;
  }

  getAllPeers(): PeerNode[] {
    return (this.stmtGetAll.all() as PeerRow[]).map(rowToPeer);
  }

  getTrustedPeers(minTrust: TrustLevel): PeerNode[] {
    return (this.stmtGetTrusted.all(minTrust) as PeerRow[]).map(rowToPeer);
  }

  removePeer(nodeId: string): boolean {
    const result = this.stmtDelete.run(nodeId);
    return result.changes > 0;
  }

  recordHandshake(nodeId: string, assignedTrust: TrustLevel): PeerNode | null {
    const now = new Date().toISOString();
    this.stmtRecordHandshake.run(assignedTrust, now, now, nodeId);
    return this.getPeer(nodeId);
  }

  recordFailure(nodeId: string): void {
    this.stmtIncrementFailure.run(nodeId);
  }

  setTrustLevel(nodeId: string, level: TrustLevel): boolean {
    const result = this.stmtSetTrust.run(level, nodeId);
    return result.changes > 0;
  }

  count(): number {
    const row = this.stmtCount.get() as { count: number };
    return row.count;
  }
}
