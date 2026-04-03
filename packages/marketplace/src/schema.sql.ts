/**
 * Marketplace SQLite schema — Claude Code-compatible.
 */

export const MARKETPLACE_SCHEMA = `
CREATE TABLE IF NOT EXISTS marketplace_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'github',
  name TEXT NOT NULL,
  description TEXT,
  last_synced_at TEXT,
  plugin_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS marketplace_plugins (
  name TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES marketplace_sources(id) ON DELETE CASCADE,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'plugin',
  version TEXT,
  author_name TEXT,
  author_email TEXT,
  category TEXT,
  tags TEXT,
  keywords TEXT,
  license TEXT,
  homepage TEXT,
  source_json TEXT NOT NULL,
  PRIMARY KEY (name, source_id)
);

CREATE TABLE IF NOT EXISTS marketplace_installed (
  name TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES marketplace_sources(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'plugin',
  version TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  install_path TEXT NOT NULL,
  source_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plugins_type ON marketplace_plugins(type);
CREATE INDEX IF NOT EXISTS idx_plugins_source ON marketplace_plugins(source_id);
`;

/** Migration statements to add provides/depends and trust/integrity columns. Run with try/catch per statement. */
export const MARKETPLACE_MIGRATIONS = [
  "ALTER TABLE marketplace_plugins ADD COLUMN provides TEXT",
  "ALTER TABLE marketplace_plugins ADD COLUMN depends TEXT",
  "ALTER TABLE marketplace_plugins ADD COLUMN trust_tier TEXT DEFAULT 'unknown'",
  "ALTER TABLE marketplace_plugins ADD COLUMN integrity_hash TEXT",
  "ALTER TABLE marketplace_plugins ADD COLUMN signed_by TEXT",
  "ALTER TABLE marketplace_installed ADD COLUMN integrity_hash TEXT",
  "ALTER TABLE marketplace_installed ADD COLUMN trust_tier TEXT DEFAULT 'unknown'",
];
