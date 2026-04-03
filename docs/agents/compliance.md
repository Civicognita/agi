# Compliance Control System

Technical reference for the UCS compliance controls. For human-readable documentation, see `docs/human/security.md`.

## Architecture

The compliance system is built from independent stores that share the entity database. Each store creates its own table on first access (idempotent DDL).

## Module Map

| Module | Package | Purpose | UCS Control |
|--------|---------|---------|-------------|
| `crypto.ts` | entity-model | AES-256-GCM field encryption | UCS-CRYPT-02 |
| `incident-store.ts` | entity-model | Breach tracking + notification clocks | UCS-IR-01 |
| `consent-store.ts` | entity-model | Per-entity consent per purpose | UCS-PRIV-01 |
| `vendor-store.ts` | entity-model | Third-party processor tracking | UCS-VEND-01 |
| `session-store.ts` | entity-model | Session revocation + API key lifecycle | UCS-IAM-02 |
| `mfa.ts` | gateway-core | TOTP/RFC 6238 + recovery codes | UCS-IAM-01 |
| `backup-manager.ts` | gateway-core | Scheduled SQLite backups | UCS-BCM-01 |
| `logger.ts` | coa-chain | Source IP + integrity hash chain | UCS-LOG-01 |

## Files to Modify

### Wiring into server boot (`packages/gateway-core/src/server.ts`)

After database creation, instantiate the compliance stores:

```typescript
import { IncidentStore, ConsentStore, VendorStore, SessionStore } from "@aionima/entity-model";
import { BackupManager } from "./backup-manager.js";

const incidentStore = new IncidentStore(db);
const consentStore = new ConsentStore(db);
const vendorStore = new VendorStore(db);
const sessionStore = new SessionStore(db);

// Seed vendors from config
vendorStore.seedFromConfig(config);

// Start backups if enabled
if (config.backup?.enabled !== false) {
  const backupManager = new BackupManager({
    backupDir: config.backup?.dir ?? join(homedir(), ".agi", "backups"),
    databases: [{ name: "entities", db }, { name: "marketplace", db: marketplaceDb }],
    retentionDays: config.backup?.retentionDays ?? 30,
    logger,
  });
  backupManager.startSchedule();
}
```

### Adding API routes

Create compliance API routes in `server-runtime-state.ts` or a new `compliance-api.ts`:

- `GET /api/compliance/incidents` — list incidents
- `POST /api/compliance/incidents` — create incident
- `PUT /api/compliance/incidents/:id/status` — update status
- `GET /api/compliance/consents/:entityId` — get consent records
- `POST /api/compliance/consents/:entityId` — grant/revoke consent
- `GET /api/compliance/vendors` — list vendors
- `POST /api/compliance/vendors` — upsert vendor
- `GET /api/compliance/sessions` — list active sessions
- `DELETE /api/compliance/sessions/:id` — revoke session
- `GET /api/compliance/backups` — list backups
- `POST /api/compliance/backups` — trigger manual backup

### Config schema (`config/src/schema.ts`)

New config sections:
- `backup.enabled` (boolean, default true)
- `backup.dir` (string, default `~/.agi/backups`)
- `backup.retentionDays` (number, default 30)
- `compliance.encryptionAtRest` (boolean, default false)
- `compliance.encryptionKey` (string, optional — hex-encoded 32-byte key)
- `compliance.requireMfa` (boolean, default false)
- `logging.retentionDays` (number, default 365 — PCI requirement)
- `logging.hotRetentionDays` (number, default 90 — PCI requirement)

### COA chain schema migration

Two new columns added via `COA_COMPLIANCE_MIGRATIONS`:
- `source_ip TEXT` — request origin IP
- `integrity_hash TEXT` — SHA-256 chain hash

Migration is idempotent (ALTER TABLE ADD COLUMN, caught on duplicate).

## Testing

```bash
# Verify compliance stores initialize
pnpm test -- --grep "compliance"

# Verify COA integrity chain
pnpm test -- --grep "coa.*integrity"

# Verify encryption round-trip
pnpm test -- --grep "crypto"
```

## Regulatory Mapping

| UCS Control | SOC 2 | HIPAA | PCI DSS | GDPR | NIST |
|-------------|-------|-------|---------|------|------|
| UCS-LOG-01 | CC7 monitoring | 164.312(b) audit | Req 10 + 10.5.1 | Art 33(5) | AU family |
| UCS-CRYPT-02 | Confidentiality | Encryption guidance | Req 3 | Art 32 | SC-13 |
| UCS-IAM-01 | CC6 logical access | 164.312 access | 8.4.2 MFA | Art 32 | IA-2(1) |
| UCS-IR-01 | Incident handling | Breach ≤60d | Incident support | ≤72h notice | IR family |
| UCS-PRIV-01 | Privacy category | Privacy Rule | — | Art 6/7 | — |
| UCS-PRIV-02 | Privacy monitoring | Access right | — | Art 15/17/20 | — |
| UCS-VEND-01 | Vendor focus | BAA 164.504(e) | 12.8.4 TPSP | Art 28 | SR family |
| UCS-BCM-01 | Availability | Contingency | — | Art 32 restore | CP family |
| UCS-IAM-02 | CC6 access | Access mgmt | Req 8 | Art 32 | AC family |
