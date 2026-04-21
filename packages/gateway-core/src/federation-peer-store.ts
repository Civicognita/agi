/**
 * Federation Peer Store — Postgres/drizzle-backed persistent peer storage.
 *
 * Replaces the in-memory Map in FederationNode with durable storage
 * so peers survive restarts.
 */

import { eq, gte, sql } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import { federationPeers } from "@agi/db-schema";
import type { PeerNode, DiscoveryMethod, TrustLevel } from "./federation-types.js";

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToPeer(row: typeof federationPeers.$inferSelect): PeerNode {
  return {
    nodeId: row.nodeId,
    endpoint: row.endpoint,
    publicKey: row.publicKey,
    trustLevel: row.trustLevel as TrustLevel,
    discoveryMethod: row.discoveryMethod as DiscoveryMethod,
    lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : String(row.lastSeen),
    lastHandshake: row.lastHandshake instanceof Date ? row.lastHandshake.toISOString() : (row.lastHandshake ?? null),
    failureCount: row.failureCount,
    online: row.failureCount < 5,
  };
}

// ---------------------------------------------------------------------------
// FederationPeerStore
// ---------------------------------------------------------------------------

export class FederationPeerStore {
  constructor(private readonly db: Db) {}

  async addPeer(
    nodeId: string,
    endpoint: string,
    publicKey: string,
    method: DiscoveryMethod,
    trustLevel: TrustLevel = 0,
    opts?: { geid?: string; displayName?: string },
  ): Promise<PeerNode> {
    const now = new Date();
    await this.db
      .insert(federationPeers)
      .values({
        nodeId,
        geid: opts?.geid ?? "",
        endpoint,
        publicKey,
        trustLevel,
        discoveryMethod: method,
        displayName: opts?.displayName ?? null,
        lastSeen: now,
        lastHandshake: null,
        failureCount: 0,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: federationPeers.nodeId,
        set: {
          endpoint,
          publicKey,
          trustLevel,
          displayName: opts?.displayName ?? null,
          lastSeen: now,
        },
      });

    return {
      nodeId,
      endpoint,
      publicKey,
      trustLevel,
      discoveryMethod: method,
      lastSeen: now.toISOString(),
      lastHandshake: null,
      failureCount: 0,
      online: true,
    };
  }

  async getPeer(nodeId: string): Promise<PeerNode | null> {
    const [row] = await this.db
      .select()
      .from(federationPeers)
      .where(eq(federationPeers.nodeId, nodeId));
    return row ? rowToPeer(row) : null;
  }

  async getAllPeers(): Promise<PeerNode[]> {
    const rows = await this.db
      .select()
      .from(federationPeers)
      .orderBy(federationPeers.lastSeen);
    return rows.map(rowToPeer);
  }

  async getTrustedPeers(minTrust: TrustLevel): Promise<PeerNode[]> {
    const rows = await this.db
      .select()
      .from(federationPeers)
      .where(gte(federationPeers.trustLevel, minTrust))
      .orderBy(federationPeers.lastSeen);
    return rows.map(rowToPeer);
  }

  async removePeer(nodeId: string): Promise<boolean> {
    const result = await this.db
      .delete(federationPeers)
      .where(eq(federationPeers.nodeId, nodeId))
      .returning({ nodeId: federationPeers.nodeId });
    return result.length > 0;
  }

  async recordHandshake(nodeId: string, assignedTrust: TrustLevel): Promise<PeerNode | null> {
    const now = new Date();
    await this.db
      .update(federationPeers)
      .set({ trustLevel: assignedTrust, lastHandshake: now, lastSeen: now, failureCount: 0 })
      .where(eq(federationPeers.nodeId, nodeId));
    return this.getPeer(nodeId);
  }

  async recordFailure(nodeId: string): Promise<void> {
    await this.db
      .update(federationPeers)
      .set({ failureCount: sql`${federationPeers.failureCount} + 1` })
      .where(eq(federationPeers.nodeId, nodeId));
  }

  async setTrustLevel(nodeId: string, level: TrustLevel): Promise<boolean> {
    const result = await this.db
      .update(federationPeers)
      .set({ trustLevel: level })
      .where(eq(federationPeers.nodeId, nodeId))
      .returning({ nodeId: federationPeers.nodeId });
    return result.length > 0;
  }

  async count(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(federationPeers);
    return row?.count ?? 0;
  }
}
