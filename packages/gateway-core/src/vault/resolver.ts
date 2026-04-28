/**
 * vault/resolver — runtime substitution of `vault://<id>` references (s128 t496).
 *
 * The Vault feature lets project config carry references like
 * `mcp.servers.tynn.authToken: "vault://01H..."` instead of plaintext
 * secrets. At call time (e.g., when the MCP client connects), the
 * resolver substitutes the reference with the decrypted value from the
 * Vault. This means values never appear in `project.json` or `.env` —
 * they live only in the TPM2-sealed `.cred` blobs and surface for the
 * single moment they're consumed.
 *
 * Project-scoping: when a vault entry has `owningProject` set, the
 * resolver requires the caller's `context.projectPath` to match.
 * Mismatch throws `VaultResolverScopeError`. Gateway-scoped entries
 * (owningProject === null) are readable from any project.
 *
 * Non-references pass through unchanged. The resolver is deliberately
 * lenient — non-string inputs are returned as-is so the call site can
 * use it on any config field without a type-check first.
 */

import {
  extractVaultReferenceId,
  isVaultReference,
} from "./types.js";
import type { VaultStorage } from "./storage.js";

export class VaultResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultResolverError";
  }
}

export class VaultResolverNotFoundError extends VaultResolverError {
  constructor(reference: string) {
    super(`Vault reference "${reference}" did not match any entry`);
    this.name = "VaultResolverNotFoundError";
  }
}

export class VaultResolverScopeError extends VaultResolverError {
  constructor(reference: string, owningProject: string, requestingProject: string | undefined) {
    super(
      `Vault reference "${reference}" is owned by project "${owningProject}"; ` +
      (requestingProject === undefined
        ? "caller did not supply a projectPath"
        : `caller's projectPath "${requestingProject}" does not match`),
    );
    this.name = "VaultResolverScopeError";
  }
}

export interface ResolveContext {
  /** Calling project's absolute path. Required when resolving entries
   *  whose owningProject is set; optional for gateway-scoped entries. */
  projectPath?: string;
}

export class VaultResolver {
  constructor(private readonly storage: VaultStorage) {}

  /**
   * Resolve a single value. If the value is a `vault://<id>` reference,
   * look up the entry and return its decrypted value. Otherwise return
   * the input unchanged.
   *
   * Throws `VaultResolverNotFoundError` for references that don't
   * resolve and `VaultResolverScopeError` for project-scope mismatches.
   */
  async resolve(value: unknown, context: ResolveContext = {}): Promise<unknown> {
    if (!isVaultReference(value)) return value;
    const id = extractVaultReferenceId(value);
    if (id === null) throw new VaultResolverNotFoundError(value);

    const result = await this.storage.read(id);
    if (result === null) throw new VaultResolverNotFoundError(value);

    if (
      result.entry.owningProject !== null
      && result.entry.owningProject !== context.projectPath
    ) {
      throw new VaultResolverScopeError(value, result.entry.owningProject, context.projectPath);
    }

    return result.value;
  }

  /**
   * Resolve every leaf value in a record, replacing `vault://<id>`
   * strings with their decrypted values. Non-reference values pass
   * through. Used by call sites that have a config object with
   * arbitrary keys (e.g., MCP server env shape).
   *
   * Note: only top-level keys are scanned. Nested objects pass through
   * untouched — call sites with nested config should walk the tree
   * themselves and call `resolve()` per leaf, OR file a follow-up to
   * make this recursive when a real call site needs it.
   */
  async resolveRecord(
    record: Record<string, unknown>,
    context: ResolveContext = {},
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      out[key] = await this.resolve(value, context);
    }
    return out;
  }
}
