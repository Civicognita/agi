/** SQL DDL for all entity-store tables. Executed by createDatabase() at startup. */

export const CREATE_ENTITIES = `
CREATE TABLE IF NOT EXISTS entities (
  id               TEXT    NOT NULL PRIMARY KEY,
  type             TEXT    NOT NULL,
  display_name     TEXT    NOT NULL,
  verification_tier TEXT   NOT NULL DEFAULT 'unverified',
  coa_alias        TEXT    NOT NULL UNIQUE,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
)` as const;

export const CREATE_CHANNEL_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS channel_accounts (
  id              TEXT NOT NULL PRIMARY KEY,
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  channel         TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  verified        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  UNIQUE (channel, channel_user_id)
)` as const;

export const CREATE_COA_CHAINS = `
CREATE TABLE IF NOT EXISTS coa_chains (
  fingerprint   TEXT NOT NULL PRIMARY KEY,
  resource_id   TEXT NOT NULL,
  entity_id     TEXT NOT NULL REFERENCES entities(id),
  node_id       TEXT NOT NULL,
  chain_counter INTEGER NOT NULL,
  work_type     TEXT NOT NULL,
  ref           TEXT,
  action        TEXT,
  payload_hash  TEXT,
  fork_id       TEXT,
  created_at    TEXT NOT NULL
)` as const;

export const CREATE_IMPACT_INTERACTIONS = `
CREATE TABLE IF NOT EXISTS impact_interactions (
  id              TEXT NOT NULL PRIMARY KEY,
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  coa_fingerprint TEXT NOT NULL REFERENCES coa_chains(fingerprint),
  channel         TEXT,
  work_type       TEXT,
  quant           REAL NOT NULL,
  value_0bool     REAL NOT NULL,
  bonus           REAL NOT NULL DEFAULT 0,
  imp_score       REAL NOT NULL,
  created_at      TEXT NOT NULL
)` as const;

export const CREATE_MESSAGE_QUEUE = `
CREATE TABLE IF NOT EXISTS message_queue (
  id           TEXT NOT NULL PRIMARY KEY,
  channel      TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  payload      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  retries      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  processed_at TEXT
)` as const;

export const CREATE_VERIFICATION_REQUESTS = `
CREATE TABLE IF NOT EXISTS verification_requests (
  id                TEXT NOT NULL PRIMARY KEY,
  entity_id         TEXT NOT NULL REFERENCES entities(id),
  entity_type       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  proof_type        TEXT NOT NULL,
  proof_payload     TEXT NOT NULL,
  proof_submitted_at TEXT NOT NULL,
  proof_submitted_by TEXT NOT NULL,
  reviewer_id       TEXT,
  decision          TEXT,
  decision_reason   TEXT,
  decision_at       TEXT,
  coa_fingerprint   TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
)` as const;

export const CREATE_SEALS = `
CREATE TABLE IF NOT EXISTS seals (
  seal_id      TEXT NOT NULL PRIMARY KEY,
  entity_id    TEXT NOT NULL REFERENCES entities(id),
  entity_type  TEXT NOT NULL,
  issued_at    TEXT NOT NULL,
  issued_by    TEXT NOT NULL,
  coa          TEXT NOT NULL,
  alignment_aa REAL NOT NULL,
  alignment_uu REAL NOT NULL,
  alignment_cc REAL NOT NULL,
  checksum     TEXT NOT NULL,
  grid         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  revoked_at   TEXT,
  revoked_by   TEXT,
  revoke_reason TEXT
)` as const;

export const CREATE_META = `
CREATE TABLE IF NOT EXISTS meta (
  key        TEXT NOT NULL PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
)` as const;

export const CREATE_MEMBERSHIPS = `
CREATE TABLE IF NOT EXISTS memberships (
  id           TEXT NOT NULL PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES entities(id),
  member_id    TEXT NOT NULL REFERENCES entities(id),
  role         TEXT NOT NULL DEFAULT 'member',
  status       TEXT NOT NULL DEFAULT 'pending',
  impact_share REAL NOT NULL DEFAULT 0.10,
  invited_by   TEXT NOT NULL,
  joined_at    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (org_id, member_id)
)` as const;

export const CREATE_COMMS_LOG = `
CREATE TABLE IF NOT EXISTS comms_log (
  id           TEXT NOT NULL PRIMARY KEY,
  channel      TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_id    TEXT NOT NULL,
  sender_name  TEXT,
  subject      TEXT,
  preview      TEXT NOT NULL,
  full_payload TEXT NOT NULL,
  entity_id    TEXT,
  created_at   TEXT NOT NULL
)` as const;

export const CREATE_NOTIFICATIONS = `
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT NOT NULL PRIMARY KEY,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  metadata   TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)` as const;

export const CREATE_GEID_MAPPINGS = `
CREATE TABLE IF NOT EXISTS geid_mappings (
  local_entity_id TEXT NOT NULL PRIMARY KEY REFERENCES entities(id),
  geid            TEXT NOT NULL UNIQUE,
  public_key_pem  TEXT NOT NULL,
  private_key_pem TEXT,
  discoverable    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
)` as const;

export const CREATE_FEDERATION_PEERS = `
CREATE TABLE IF NOT EXISTS federation_peers (
  node_id          TEXT NOT NULL PRIMARY KEY,
  geid             TEXT NOT NULL,
  endpoint         TEXT NOT NULL,
  public_key       TEXT NOT NULL,
  trust_level      INTEGER NOT NULL DEFAULT 0,
  discovery_method TEXT NOT NULL DEFAULT 'manual',
  display_name     TEXT,
  last_seen        TEXT NOT NULL,
  last_handshake   TEXT,
  failure_count    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
)` as const;

export const CREATE_ENTITY_MAP_CACHE = `
CREATE TABLE IF NOT EXISTS entity_map_cache (
  geid          TEXT NOT NULL PRIMARY KEY,
  address       TEXT NOT NULL,
  entity_map    TEXT NOT NULL,
  home_node_id  TEXT NOT NULL,
  fetched_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1
)` as const;

export const CREATE_ACCESS_GRANTS = `
CREATE TABLE IF NOT EXISTS access_grants (
  id          TEXT NOT NULL PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  role        TEXT NOT NULL DEFAULT 'viewer',
  scope       TEXT NOT NULL DEFAULT 'read-only',
  granted_by  TEXT NOT NULL,
  expires_at  TEXT,
  created_at  TEXT NOT NULL
)` as const;

export const FEDERATION_MIGRATIONS = `
-- Federation columns on entities (idempotent via try/catch in runner)
ALTER TABLE entities ADD COLUMN geid TEXT;
ALTER TABLE entities ADD COLUMN public_key_pem TEXT;
ALTER TABLE entities ADD COLUMN home_node_id TEXT;
ALTER TABLE entities ADD COLUMN federation_consent TEXT NOT NULL DEFAULT 'none';
-- Federation columns on impact_interactions
ALTER TABLE impact_interactions ADD COLUMN origin_node_id TEXT;
ALTER TABLE impact_interactions ADD COLUMN relay_signature TEXT;
` as const;

export const COA_MIGRATIONS = `
-- COA fork tracking column (idempotent via try/catch in runner)
ALTER TABLE coa_chains ADD COLUMN fork_id TEXT;
` as const;

export const COA_COMPLIANCE_MIGRATIONS = [
  "ALTER TABLE coa_chains ADD COLUMN source_ip TEXT;",
  "ALTER TABLE coa_chains ADD COLUMN integrity_hash TEXT;",
] as const;

/** All DDL statements in dependency order (parents before children). */
export const ALL_DDL = [
  CREATE_ENTITIES,
  CREATE_CHANNEL_ACCOUNTS,
  CREATE_COA_CHAINS,
  CREATE_IMPACT_INTERACTIONS,
  CREATE_VERIFICATION_REQUESTS,
  CREATE_SEALS,
  CREATE_MESSAGE_QUEUE,
  CREATE_META,
  CREATE_MEMBERSHIPS,
  CREATE_COMMS_LOG,
  CREATE_NOTIFICATIONS,
  CREATE_GEID_MAPPINGS,
  CREATE_FEDERATION_PEERS,
  CREATE_ENTITY_MAP_CACHE,
  CREATE_ACCESS_GRANTS,
] as const;
