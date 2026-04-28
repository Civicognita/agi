/**
 * vault/storage — file-backed Vault entry storage (s128 t493).
 *
 * Stores typed Vault metadata as `<id>.json` sidecars in a configurable
 * directory; delegates value encryption to a structurally-compatible
 * SecretsBackend (production: SecretsManager TPM2-sealed `.cred` files;
 * tests: in-memory mock).
 *
 * Layout:
 *   <vaultDir>/<entry-id>.json        — VaultEntry metadata
 *   (secretsBackend keyed by `vault_<entry-id>`)  — encrypted value
 *
 * Why a backend interface and not direct SecretsManager use:
 * SecretsManager.writeSecret runs `sudo systemd-creds encrypt`, which
 * won't run in unit tests or dev environments without systemd. The
 * interface lets tests substitute an in-memory backend; production
 * receives the real SecretsManager. Same encryption guarantees in
 * production; cleanly testable in CI.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import {
  parseVaultEntry,
  type VaultEntry,
  type VaultEntryCreate,
} from "./types.js";

/** Structurally compatible with SecretsManager. The backend stores +
 *  retrieves the raw value bytes; metadata + lifecycle is owned by
 *  VaultStorage. Method names match SecretsManager so the production
 *  code path is `new VaultStorage({ secretsBackend: secretsManager, ... })`. */
export interface SecretsBackend {
  writeSecret(name: string, value: string): Promise<void>;
  readSecret(name: string): string | undefined;
  deleteSecret(name: string): Promise<void>;
}

/** Namespacing prefix for vault-stored secrets. Keeps Vault values out
 *  of SecretsManager's flat env-var-shape namespace. The full key is
 *  `vault_<entry-id>` and the corresponding `.cred` lives at
 *  `<secretsDir>/vault_<entry-id>.cred`. */
const SECRET_KEY_PREFIX = "vault_";

function secretKey(entryId: string): string {
  return `${SECRET_KEY_PREFIX}${entryId}`;
}

export interface VaultStorageOptions {
  vaultDir: string;
  secretsBackend: SecretsBackend;
  /** Optional clock for deterministic testing. Defaults to Date.now. */
  now?: () => Date;
  /** Optional id generator for deterministic testing. Defaults to ulid. */
  idGenerator?: () => string;
}

export class VaultStorage {
  private readonly vaultDir: string;
  private readonly backend: SecretsBackend;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(opts: VaultStorageOptions) {
    this.vaultDir = opts.vaultDir;
    this.backend = opts.secretsBackend;
    this.now = opts.now ?? (() => new Date());
    this.idGenerator = opts.idGenerator ?? ulid;
  }

  /** Ensure the vault directory exists. Idempotent. Mode 0o700 to mirror
   *  SecretsManager's per-user-only secrets dir convention. */
  initialize(): void {
    if (!existsSync(this.vaultDir)) {
      mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
    }
  }

  /** Create a new Vault entry. Generates id + created timestamp; persists
   *  metadata sidecar + delegates value encryption to the backend. */
  async create(input: VaultEntryCreate): Promise<VaultEntry> {
    this.initialize();
    const id = this.idGenerator();
    const created = this.now().toISOString();
    const entry: VaultEntry = {
      id,
      name: input.name,
      type: input.type,
      created,
      lastAccessed: null,
      owningProject: input.owningProject ?? null,
      ...(input.description !== undefined ? { description: input.description } : {}),
    };

    // Order matters: write the encrypted value first so a metadata-only
    // ghost can't survive a partial-write crash. If the metadata write
    // throws afterward, the secret is recoverable by re-create with the
    // same id (caller responsibility) or via a future cleanup pass that
    // looks for orphaned `vault_<id>` keys without `.json` sidecars.
    await this.backend.writeSecret(secretKey(id), input.value);
    writeFileSync(this.metadataPath(id), JSON.stringify(entry, null, 2), { mode: 0o600 });

    return entry;
  }

  /** Read a Vault entry's metadata + value. Returns null when no entry
   *  matches. Updates lastAccessed timestamp on success. */
  async read(id: string): Promise<{ entry: VaultEntry; value: string } | null> {
    const entry = this.readMetadata(id);
    if (entry === null) return null;
    const value = this.backend.readSecret(secretKey(id));
    if (value === undefined) return null;

    const updated: VaultEntry = { ...entry, lastAccessed: this.now().toISOString() };
    try {
      writeFileSync(this.metadataPath(id), JSON.stringify(updated, null, 2), { mode: 0o600 });
    } catch {
      // lastAccessed update is a best-effort observability signal; a
      // failure to persist it doesn't fail the read. The value is
      // returned regardless.
    }
    return { entry: updated, value };
  }

  /** Read metadata only — no value, no lastAccessed update. Used by
   *  `list()` and by surfaces that need the typed shape without the
   *  decrypted value (e.g., dashboard's vault listing). */
  readMetadata(id: string): VaultEntry | null {
    const path = this.metadataPath(id);
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, "utf-8");
      return parseVaultEntry(JSON.parse(raw));
    } catch {
      // Corrupt or unparseable metadata — treat as missing. A dedicated
      // cleanup pass can collect these via a separate verify-and-prune
      // operation; reads should never throw on corruption.
      return null;
    }
  }

  /** List all Vault entries. Caller-side filtering by owningProject is
   *  expected (the dashboard's per-project view, the cross-project search,
   *  etc); centralizing here would couple storage to authorization. */
  list(): VaultEntry[] {
    if (!existsSync(this.vaultDir)) return [];
    const entries: VaultEntry[] = [];
    for (const file of readdirSync(this.vaultDir)) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      const entry = this.readMetadata(id);
      if (entry !== null) entries.push(entry);
    }
    return entries;
  }

  /** Delete a Vault entry. Removes both the metadata sidecar and the
   *  encrypted value. Returns true when something was deleted, false if
   *  no entry matched. */
  async delete(id: string): Promise<boolean> {
    const path = this.metadataPath(id);
    const existed = existsSync(path);
    if (existed) {
      try { unlinkSync(path); } catch { /* already gone */ }
    }
    // Always attempt backend delete — covers the orphaned-secret case
    // where metadata vanished but the value remained.
    await this.backend.deleteSecret(secretKey(id));
    return existed;
  }

  private metadataPath(id: string): string {
    return join(this.vaultDir, `${id}.json`);
  }
}
