/**
 * Local Identity Provider — issues and manages entity identities.
 *
 * Each node can issue its own identities, making the centralized
 * id.aionima.ai handoff optional. Entities get GEID keypairs
 * automatically on creation.
 */

import type { EntityStore, GEID } from "@agi/entity-model";
import { signIdentityStatement, formatAddress } from "@agi/entity-model";
import type { FederationNode } from "./federation-node.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdentityProviderConfig {
  /** Auto-generate GEID for new entities (default: true). */
  autoGeid: boolean;
  /** Node alias for address formatting. */
  nodeAlias: string;
}

export interface IssuedIdentity {
  entityId: string;
  geid: GEID;
  address: string;
  publicKeyPem: string;
}

export interface IdentityBindingResult {
  success: boolean;
  entityId?: string;
  geid?: GEID;
  error?: string;
}

// ---------------------------------------------------------------------------
// IdentityProvider
// ---------------------------------------------------------------------------

/**
 * Manages local identity issuance and GEID binding.
 *
 * Responsibilities:
 * - Issue GEID keypairs for new entities
 * - Bind OAuth identities to entities
 * - Generate identity statements (signed claims)
 * - Format COA addresses for entities
 */
export class IdentityProvider {
  private readonly entityStore: EntityStore;
  private readonly federationNode: FederationNode | null;
  private readonly config: IdentityProviderConfig;

  constructor(
    entityStore: EntityStore,
    federationNode: FederationNode | null,
    config: Partial<IdentityProviderConfig> = {},
  ) {
    this.entityStore = entityStore;
    this.federationNode = federationNode;
    this.config = {
      autoGeid: config.autoGeid ?? true,
      nodeAlias: config.nodeAlias ?? "#O0",
    };
  }

  /**
   * Get the identity info for an entity (GEID + address).
   * Returns null if the entity has no GEID.
   */
  getIdentity(entityId: string): IssuedIdentity | null {
    const entity = this.entityStore.getEntity(entityId);
    if (!entity) return null;

    const mapping = this.entityStore.getGeidMapping(entityId);
    if (!mapping) return null;

    const address = formatAddress(entity.coaAlias, this.config.nodeAlias);

    return {
      entityId: entity.id,
      geid: mapping.geid,
      address,
      publicKeyPem: mapping.publicKeyPem,
    };
  }

  /**
   * Resolve an entity by GEID.
   */
  resolveByGeid(geid: string): IssuedIdentity | null {
    const entity = this.entityStore.getByGeid(geid);
    if (!entity) return null;

    const mapping = this.entityStore.getGeidMapping(entity.id);
    if (!mapping) return null;

    const address = formatAddress(entity.coaAlias, this.config.nodeAlias);

    return {
      entityId: entity.id,
      geid: mapping.geid,
      address,
      publicKeyPem: mapping.publicKeyPem,
    };
  }

  /**
   * Resolve an entity by COA address.
   */
  resolveByAddress(address: string): IssuedIdentity | null {
    const entity = this.entityStore.getByAddress(address);
    if (!entity) return null;

    const mapping = this.entityStore.getGeidMapping(entity.id);
    if (!mapping) return null;

    return {
      entityId: entity.id,
      geid: mapping.geid,
      address: formatAddress(entity.coaAlias, this.config.nodeAlias),
      publicKeyPem: mapping.publicKeyPem,
    };
  }

  /**
   * Generate a signed identity statement for an entity.
   * Used for cross-node identity verification.
   */
  generateIdentityStatement(entityId: string): {
    statement: ReturnType<typeof signIdentityStatement>;
    nodeEndorsement: string;
  } | null {
    const mapping = this.entityStore.getGeidMapping(entityId);
    if (!mapping || !mapping.privateKeyPem) return null;

    const nodeId = this.federationNode?.getNodeId() ?? this.config.nodeAlias;
    const statement = signIdentityStatement(
      mapping.privateKeyPem,
      mapping.geid,
      entityId,
      nodeId,
    );

    // Node counter-signature if federation is available
    let nodeEndorsement = "";
    if (this.federationNode) {
      const payload = JSON.stringify(statement);
      nodeEndorsement = this.federationNode.signPayload(payload);
    }

    return { statement, nodeEndorsement };
  }

  /**
   * Bind an OAuth identity to an existing entity.
   * Stores the provider + account info as a channel account.
   */
  bindOAuthIdentity(
    entityId: string,
    provider: string,
    providerUserId: string,
  ): IdentityBindingResult {
    const entity = this.entityStore.getEntity(entityId);
    if (!entity) {
      return { success: false, error: "Entity not found" };
    }

    // Store as a channel account with provider as channel name
    const channel = `oauth:${provider}`;
    this.entityStore.upsertChannelAccount({
      entityId,
      channel,
      channelUserId: providerUserId,
    });

    const mapping = this.entityStore.getGeidMapping(entityId);

    return {
      success: true,
      entityId,
      geid: mapping?.geid,
    };
  }

  /**
   * Create a new entity with identity (for sub-user registration).
   */
  createEntityWithIdentity(params: {
    displayName: string;
    type?: "E" | "O" | "T" | "F" | "A";
  }): IssuedIdentity {
    const entity = this.entityStore.createEntity({
      type: params.type ?? "E",
      displayName: params.displayName,
    });

    // createEntity now auto-generates GEID, so just retrieve it
    const mapping = this.entityStore.getGeidMapping(entity.id);
    if (!mapping) {
      throw new Error("GEID generation failed during entity creation");
    }

    const address = formatAddress(entity.coaAlias, this.config.nodeAlias);

    return {
      entityId: entity.id,
      geid: mapping.geid,
      address,
      publicKeyPem: mapping.publicKeyPem,
    };
  }
}
