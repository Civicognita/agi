/**
 * PostgreSQL Schema — Task #189
 *
 * Same tables as schema.sql.ts but with:
 * - tenant_id column on every table
 * - Row-Level Security (RLS) policies for tenant isolation
 * - PostgreSQL-specific types (TIMESTAMPTZ, BIGINT, etc.)
 * - GiST/GIN indexes for common queries
 */

// ---------------------------------------------------------------------------
// Tenant table (no RLS — global)
// ---------------------------------------------------------------------------

export const PG_CREATE_TENANTS = `
CREATE TABLE IF NOT EXISTS tenants (
  id                     TEXT NOT NULL PRIMARY KEY,
  name                   TEXT NOT NULL,
  plan                   TEXT NOT NULL DEFAULT 'free',
  owner_id               TEXT,
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  max_entities           INTEGER NOT NULL DEFAULT 5,
  max_channels           INTEGER NOT NULL DEFAULT 2,
  max_monthly_messages   INTEGER NOT NULL DEFAULT 1000,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
)` as const;

// ---------------------------------------------------------------------------
// Entity tables (with tenant_id + RLS)
// ---------------------------------------------------------------------------

export const PG_CREATE_ENTITIES = `
CREATE TABLE IF NOT EXISTS entities (
  id                TEXT NOT NULL PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  type              TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  verification_tier TEXT NOT NULL DEFAULT 'unverified',
  coa_alias         TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, coa_alias)
)` as const;

export const PG_CREATE_CHANNEL_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS channel_accounts (
  id              TEXT NOT NULL PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  channel         TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, channel, channel_user_id)
)` as const;

export const PG_CREATE_COA_CHAINS = `
CREATE TABLE IF NOT EXISTS coa_chains (
  fingerprint   TEXT NOT NULL PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  resource_id   TEXT NOT NULL,
  entity_id     TEXT NOT NULL REFERENCES entities(id),
  node_id       TEXT NOT NULL,
  chain_counter INTEGER NOT NULL,
  work_type     TEXT NOT NULL,
  ref           TEXT,
  action        TEXT,
  payload_hash  TEXT,
  fork_id       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
)` as const;

export const PG_CREATE_IMPACT_INTERACTIONS = `
CREATE TABLE IF NOT EXISTS impact_interactions (
  id              TEXT NOT NULL PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  coa_fingerprint TEXT NOT NULL REFERENCES coa_chains(fingerprint),
  channel         TEXT,
  work_type       TEXT,
  quant           DOUBLE PRECISION NOT NULL,
  value_0bool     DOUBLE PRECISION NOT NULL,
  bonus           DOUBLE PRECISION NOT NULL DEFAULT 0,
  imp_score       DOUBLE PRECISION NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)` as const;

export const PG_CREATE_VERIFICATION_REQUESTS = `
CREATE TABLE IF NOT EXISTS verification_requests (
  id                 TEXT NOT NULL PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id),
  entity_id          TEXT NOT NULL REFERENCES entities(id),
  entity_type        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  proof_type         TEXT NOT NULL,
  proof_payload      TEXT NOT NULL,
  proof_submitted_at TIMESTAMPTZ NOT NULL,
  proof_submitted_by TEXT NOT NULL,
  reviewer_id        TEXT,
  decision           TEXT,
  decision_reason    TEXT,
  decision_at        TIMESTAMPTZ,
  coa_fingerprint    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
)` as const;

export const PG_CREATE_SEALS = `
CREATE TABLE IF NOT EXISTS seals (
  seal_id       TEXT NOT NULL PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  entity_id     TEXT NOT NULL REFERENCES entities(id),
  entity_type   TEXT NOT NULL,
  issued_at     TIMESTAMPTZ NOT NULL,
  issued_by     TEXT NOT NULL,
  coa           TEXT NOT NULL,
  alignment_aa  DOUBLE PRECISION NOT NULL,
  alignment_uu  DOUBLE PRECISION NOT NULL,
  alignment_cc  DOUBLE PRECISION NOT NULL,
  checksum      TEXT NOT NULL,
  grid          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  revoked_at    TIMESTAMPTZ,
  revoked_by    TEXT,
  revoke_reason TEXT
)` as const;

export const PG_CREATE_MESSAGE_QUEUE = `
CREATE TABLE IF NOT EXISTS message_queue (
  id           TEXT NOT NULL PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  channel      TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  payload      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  retries      INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
)` as const;

export const PG_CREATE_META = `
CREATE TABLE IF NOT EXISTS meta (
  key        TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key)
)` as const;

export const PG_CREATE_MEMBERSHIPS = `
CREATE TABLE IF NOT EXISTS memberships (
  id           TEXT NOT NULL PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  org_id       TEXT NOT NULL REFERENCES entities(id),
  member_id    TEXT NOT NULL REFERENCES entities(id),
  role         TEXT NOT NULL DEFAULT 'member',
  status       TEXT NOT NULL DEFAULT 'pending',
  impact_share DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  invited_by   TEXT NOT NULL,
  joined_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, org_id, member_id)
)` as const;

// ---------------------------------------------------------------------------
// Sessions table (multi-user agent sessions)
// ---------------------------------------------------------------------------

export const PG_CREATE_SESSIONS = `
CREATE TABLE IF NOT EXISTS agent_sessions (
  id              TEXT NOT NULL PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_count   INTEGER NOT NULL DEFAULT 0,
  context_tokens  INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB DEFAULT '{}'
)` as const;

// ---------------------------------------------------------------------------
// Row-Level Security
// ---------------------------------------------------------------------------

/** Tables that need RLS policies. */
const RLS_TABLES = [
  "entities",
  "channel_accounts",
  "coa_chains",
  "impact_interactions",
  "verification_requests",
  "seals",
  "message_queue",
  "meta",
  "memberships",
  "agent_sessions",
] as const;

/**
 * Generate RLS setup SQL for all tenant-scoped tables.
 * Uses `current_setting('app.current_tenant')` — set per-connection.
 */
export function generateRLSPolicies(): string {
  const statements: string[] = [];

  for (const table of RLS_TABLES) {
    statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    statements.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    statements.push(
      `CREATE POLICY ${table}_tenant_isolation ON ${table} ` +
      `USING (tenant_id = current_setting('app.current_tenant')) ` +
      `WITH CHECK (tenant_id = current_setting('app.current_tenant'))`,
    );
  }

  return statements.join(";\n") + ";";
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

export const PG_CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_entities_tenant ON entities (tenant_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_entity ON channel_accounts (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_lookup ON channel_accounts (tenant_id, channel, channel_user_id);
CREATE INDEX IF NOT EXISTS idx_coa_chains_entity ON coa_chains (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_coa_chains_created ON coa_chains (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_impact_entity ON impact_interactions (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_impact_created ON impact_interactions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_entity ON verification_requests (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_verification_status ON verification_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_seals_entity ON seals (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_message_queue_status ON message_queue (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships (tenant_id, org_id);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON memberships (tenant_id, member_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON agent_sessions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_entity ON agent_sessions (tenant_id, entity_id);
` as const;

// ---------------------------------------------------------------------------
// All PostgreSQL DDL in dependency order
// ---------------------------------------------------------------------------

export const PG_ALL_DDL = [
  PG_CREATE_TENANTS,
  PG_CREATE_ENTITIES,
  PG_CREATE_CHANNEL_ACCOUNTS,
  PG_CREATE_COA_CHAINS,
  PG_CREATE_IMPACT_INTERACTIONS,
  PG_CREATE_VERIFICATION_REQUESTS,
  PG_CREATE_SEALS,
  PG_CREATE_MESSAGE_QUEUE,
  PG_CREATE_META,
  PG_CREATE_MEMBERSHIPS,
  PG_CREATE_SESSIONS,
  PG_CREATE_INDEXES,
] as const;
