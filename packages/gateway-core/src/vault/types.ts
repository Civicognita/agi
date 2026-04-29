/**
 * vault/types — Vault entry schema (s128 t492).
 *
 * The Vault is a structured layer on top of TPM2-sealed secrets storage
 * (see ~/.agi/secrets/, managed by SecretsManager). Where SecretsManager
 * stores raw env-var-shaped `.cred` blobs, the Vault adds:
 *   - typed entries (key | password | token)
 *   - human-readable names + ids decoupled from env-var-name slots
 *   - per-entry metadata (created, lastAccessed, owningProject)
 *   - reference syntax (`vault://<entry-id>`) for runtime resolution
 *
 * This file defines the schema only. Storage (t493), API (t494), UI (t495),
 * reference resolver (t496), migration (t497), and audit hooks (t498)
 * land in subsequent tasks.
 *
 * On-disk format (t493 will implement):
 *   ~/.agi/secrets/vault/<entry-id>.json — metadata
 *   ~/.agi/secrets/vault/<entry-id>.cred — TPM2-sealed value
 *
 * The `.cred` file remains the same SecretsManager-compatible shape; the
 * `.json` sidecar carries the structured metadata that distinguishes the
 * Vault from the legacy SecretsManager flat-namespace store.
 */

/** Discrete kinds of secrets the Vault stores. Drives UI rendering
 *  (icons, masking patterns) and reference-syntax type checks. */
export type VaultEntryType = "key" | "password" | "token";

/** Stable list of allowed types — exported for runtime validation. */
export const VAULT_ENTRY_TYPES: readonly VaultEntryType[] = ["key", "password", "token"] as const;

/**
 * A single Vault entry's metadata. The ID is stable; the name is
 * human-friendly and may be edited. Timestamps are ISO 8601 strings.
 *
 * Field semantics:
 * - `id`: stable ULID; never changes; used by reference syntax (`vault://<id>`)
 * - `name`: human-readable label shown in the dashboard ("Tynn API key")
 * - `type`: kind of secret — drives UI rendering + plugin-side type-checks
 * - `created`: ISO timestamp when the entry was added to the Vault
 * - `lastAccessed`: ISO timestamp of the most recent successful read; null
 *    until first access. Set by the Vault read path (t496).
 * - `owningProject`: absolute path of the project that owns this entry,
 *    or null for gateway-scoped entries. Per-project entries are filtered
 *    by path so cross-project leakage isn't possible at the read layer.
 * - `description`: optional one-line note explaining what the secret is for.
 *    Useful when multiple entries share a similar name (e.g., two Linear keys).
 */
export interface VaultEntry {
  id: string;
  name: string;
  type: VaultEntryType;
  created: string;
  lastAccessed: string | null;
  owningProject: string | null;
  description?: string;
}

/** Input shape for creating a new Vault entry — caller supplies name + type
 *  + value + optional owningProject + description. The `id`, `created`, and
 *  `lastAccessed` are server-assigned. */
export interface VaultEntryCreate {
  name: string;
  type: VaultEntryType;
  value: string;
  owningProject?: string;
  description?: string;
}

/** Lightweight projection used by the dashboard's vault list — no value,
 *  no owningProject path leakage in the cross-project surface. */
export interface VaultEntrySummary {
  id: string;
  name: string;
  type: VaultEntryType;
  created: string;
  lastAccessed: string | null;
  ownedByProject: boolean;
  description?: string;
}

/** Parse-and-validate a metadata blob loaded from disk. Returns the typed
 *  entry on success; throws `VaultEntryParseError` on malformed input.
 *  Used by storage (t493) when reading sidecar `.json` files. */
export class VaultEntryParseError extends Error {
  constructor(reason: string) {
    super(`Vault entry malformed: ${reason}`);
    this.name = "VaultEntryParseError";
  }
}

export function parseVaultEntry(input: unknown): VaultEntry {
  if (typeof input !== "object" || input === null) {
    throw new VaultEntryParseError("payload must be an object");
  }
  const obj = input as Record<string, unknown>;
  const requireString = (field: string): string => {
    const v = obj[field];
    if (typeof v !== "string" || v.length === 0) {
      throw new VaultEntryParseError(`field "${field}" must be a non-empty string`);
    }
    return v;
  };

  const id = requireString("id");
  const name = requireString("name");
  const type = requireString("type") as VaultEntryType;
  if (!VAULT_ENTRY_TYPES.includes(type)) {
    throw new VaultEntryParseError(`field "type" must be one of ${VAULT_ENTRY_TYPES.join("|")} (got "${String(obj["type"])}")`);
  }
  const created = requireString("created");
  if (Number.isNaN(new Date(created).getTime())) {
    throw new VaultEntryParseError(`field "created" must be a valid ISO timestamp`);
  }

  const rawLast = obj["lastAccessed"];
  let lastAccessed: string | null;
  if (rawLast === null || rawLast === undefined) {
    lastAccessed = null;
  } else if (typeof rawLast === "string" && !Number.isNaN(new Date(rawLast).getTime())) {
    lastAccessed = rawLast;
  } else {
    throw new VaultEntryParseError(`field "lastAccessed" must be null or a valid ISO timestamp`);
  }

  const rawOwning = obj["owningProject"];
  let owningProject: string | null;
  if (rawOwning === null || rawOwning === undefined) {
    owningProject = null;
  } else if (typeof rawOwning === "string" && rawOwning.length > 0) {
    owningProject = rawOwning;
  } else {
    throw new VaultEntryParseError(`field "owningProject" must be null or a non-empty string`);
  }

  const rawDesc = obj["description"];
  const description = (typeof rawDesc === "string" && rawDesc.length > 0) ? rawDesc : undefined;

  return {
    id,
    name,
    type,
    created,
    lastAccessed,
    owningProject,
    ...(description !== undefined ? { description } : {}),
  };
}

/** Project a full VaultEntry to the dashboard summary shape. The
 *  `requestingProject` argument scopes ownership: when it matches the
 *  entry's owningProject, `ownedByProject` is true. Gateway-scoped entries
 *  (owningProject === null) report `ownedByProject: false` regardless. */
export function summarizeVaultEntry(
  entry: VaultEntry,
  requestingProject?: string,
): VaultEntrySummary {
  return {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    created: entry.created,
    lastAccessed: entry.lastAccessed,
    ownedByProject:
      entry.owningProject !== null
      && requestingProject !== undefined
      && entry.owningProject === requestingProject,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
  };
}

/**
 * Reference syntax: `vault://<entry-id>`. Used in project config (e.g.,
 * `mcp.servers.tynn.authToken: "vault://01H..."`). The runtime resolver
 * (t496) parses these references and substitutes the resolved value at
 * the call site, never leaking the value into project.json or .env.
 */
export const VAULT_REFERENCE_PREFIX = "vault://";

export function isVaultReference(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(VAULT_REFERENCE_PREFIX);
}

export function extractVaultReferenceId(reference: string): string | null {
  if (!reference.startsWith(VAULT_REFERENCE_PREFIX)) return null;
  const id = reference.slice(VAULT_REFERENCE_PREFIX.length);
  return id.length > 0 ? id : null;
}
