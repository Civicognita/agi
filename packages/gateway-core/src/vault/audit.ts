/**
 * vault/audit — every vault read writes a COA chain entry (s128 t498).
 *
 * The Vault feature stores secrets — every read is auditable per the
 * Aionima compliance contract. `VaultAuditor.recordRead()` writes a
 * `vault_read` work-type entry to the COA chain with:
 *   - `ref`: the entry id
 *   - `payloadHash`: SHA-256 of `<entryId>|<requestingProject>` so
 *     post-hoc audit can correlate without exposing project paths in
 *     plaintext column data
 *   - `entityId` + `entityAlias`: the calling identity (agent or owner)
 *
 * The auditor is OPTIONAL on consumer sites — both the resolver and
 * the API endpoint accept `auditor?: VaultAuditor`. Production wires
 * a real COAChainLogger; tests/dev pass `undefined` and skip the
 * audit path.
 */

import { createHash } from "node:crypto";
import type { COAChainLogger } from "@agi/coa-chain";

export interface VaultReadAuditEntry {
  /** Vault entry id that was read. */
  entryId: string;
  /** Caller's project path, when known. Hashed into the COA `payloadHash`
   *  so the audit chain doesn't store the path in plaintext column data. */
  requestingProject?: string;
  /** Caller's entity id (resolves $A0 / $E0 / etc.). */
  entityId: string;
  /** Caller's COA alias (`#E0` / `$A0`). Optional but recommended. */
  entityAlias?: string;
  /** Resource id that owns this audit entry — typically the gateway's $A0. */
  resourceId: string;
  /** Node id where the read occurred. */
  nodeId: string;
}

/** Opaque hash function — exposed for test verification. */
export function hashAuditPayload(entryId: string, requestingProject?: string): string {
  const input = `${entryId}|${requestingProject ?? "gateway-scoped"}`;
  return createHash("sha256").update(input).digest("hex");
}

export class VaultAuditor {
  constructor(private readonly logger: COAChainLogger) {}

  /** Append a `vault_read` entry to the COA chain. Returns the
   *  fingerprint of the new entry, or null when the underlying
   *  logger throws (audit failure should not fail the read). */
  async recordRead(params: VaultReadAuditEntry): Promise<string | null> {
    try {
      return await this.logger.log({
        resourceId: params.resourceId,
        entityId: params.entityId,
        ...(params.entityAlias !== undefined ? { entityAlias: params.entityAlias } : {}),
        nodeId: params.nodeId,
        workType: "vault_read",
        ref: params.entryId,
        action: "create",
        payloadHash: hashAuditPayload(params.entryId, params.requestingProject),
      });
    } catch {
      // Audit-side failures must not propagate — they would block the
      // legitimate read path. Production should monitor for null
      // fingerprints + chain-counter gaps to detect missed audits.
      return null;
    }
  }
}
