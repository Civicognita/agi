# Security & Compliance

This document covers Aionima's security controls and compliance framework. Aionima implements a unified control system (UCS) mapped to SOC 2, HIPAA, PCI DSS, GDPR, NIST SP 800-53, and ISO 27001.

---

## Authentication

The gateway HTTP API requires authentication on all routes except loopback requests and the `/api/ping` health endpoint.

### Bearer Token Auth

The primary auth method. Set one or more tokens in `gateway.json`:

```json
{
  "auth": {
    "tokens": ["$ENV{AUTH_TOKEN}"]
  }
}
```

Send the token in the `Authorization` header:

```
Authorization: Bearer <AUTH_TOKEN>
```

Tokens are compared using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks.

### Password Auth

An optional password-based alternative:

```json
{
  "auth": {
    "password": "$ENV{GATEWAY_PASSWORD}"
  }
}
```

Passwords are hashed (SHA-256) before comparison. This method is less convenient than tokens but works for simple deployments.

### Loopback Exemption

Requests from `127.0.0.1` or `::1` bypass authentication entirely. This allows the CLI and local tooling to access the gateway without a token. If you expose the gateway on a public interface (`0.0.0.0`), always set a strong `AUTH_TOKEN`.

### Auth Rate Limiting

Failed authentication attempts are tracked per IP address:

| Setting | Default |
|---------|---------|
| Max attempts per window | 10 |
| Rate limit window | 60 seconds |
| Lockout duration | 5 minutes |

After 10 failed attempts within 60 seconds, the IP is locked out for 5 minutes. Lockout state is in-memory and resets on gateway restart.

Configure in `gateway.json`:

```json
{
  "auth": {
    "maxAttemptsPerWindow": 10,
    "rateLimitWindowMs": 60000,
    "lockoutDurationMs": 300000
  }
}
```

### Request Size Limit

All HTTP requests are capped at 2 MB body size by default to prevent denial-of-service attacks (CWE-400):

```json
{
  "auth": {
    "maxBodyBytes": 2097152
  }
}
```

---

## Private Network Guard

The editor API enforces a private network guard on all file operations. It rejects requests that originate from non-private IP addresses (public internet) even if the bearer token is valid.

This is a defense-in-depth control for the file editor endpoints (`/api/files/read`, `/api/files/write`, `/api/files/project-read`, `/api/files/project-write`). The assumption is that the editor should only be accessible from within the LAN or via a secure tunnel — not directly from the internet.

Private IP ranges allowed:
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `127.0.0.0/8`
- `::1` (IPv6 loopback)
- `fc00::/7` (IPv6 unique local)

If you access the dashboard through a reverse proxy that terminates TLS, ensure the proxy forwards the client's real IP via `X-Forwarded-For` or `X-Real-IP` headers so the guard can evaluate the correct address.

---

## UFW Firewall

On the production server (Ubuntu), UFW is configured to limit external access.

### Current Firewall Rules

```bash
# View rules
sudo ufw status verbose
```

Aionima's gateway (port 3100) should typically be accessible only from the LAN, not the public internet, unless you are intentionally exposing it.

Recommended UFW configuration for a home server:

```bash
# Allow SSH (if needed)
sudo ufw allow 22/tcp

# Allow gateway from LAN only (replace 192.168.0.0/24 with your subnet)
sudo ufw allow from 192.168.0.0/24 to any port 3100 proto tcp

# Allow hosted projects (Caddy)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Deny everything else by default
sudo ufw default deny incoming
sudo ufw enable
```

If signal-cli REST API is running locally, restrict it to loopback only:

```bash
# signal-cli should only be accessible locally
# The Docker/Podman binding should use 127.0.0.1:8080, not 0.0.0.0:8080
```

---

## Entity Verification Tiers

Access from external users is controlled by entity verification tiers. These tiers gate what the agent can do on behalf of a sender.

| Tier | Capabilities |
|------|-------------|
| `unverified` | Information-only responses, no tool use, no TASKMASTER |
| `verified` | Full responses, standard tool access, TASKMASTER allowed |
| `sealed` | Owner-level access: all tools, sensitive data, no restrictions |

New entities start as `unverified`. Entities become `verified` through the pairing flow. The owner's entity is automatically `sealed`.

### DM Policy

The `owner.dmPolicy` setting controls whether unverified users can even reach the agent:

- `"pairing"` (default) — unknown senders receive a pairing prompt. The agent does not process their messages until they are paired.
- `"open"` — all senders are allowed through as `unverified`. The agent responds but with restricted capabilities.

For a personal assistant deployment, `"pairing"` is strongly recommended. It prevents unknown parties from interacting with your Aionima instance.

---

## Per-Entity Rate Limiting

The agent pipeline enforces per-entity rate limits to prevent a single user from monopolizing resources or triggering excessive API usage.

Defaults by gateway state:

| State | Requests/minute | Burst allowed |
|-------|----------------|--------------|
| ONLINE | 20 | 5 |
| LIMBO | 5 | 2 |
| OFFLINE | 0 | 0 |
| UNKNOWN | 0 | 0 |

Rate limit state is in-memory and resets on gateway restart.

When an entity exceeds their rate limit:
- The message is rejected before reaching the agent.
- The entity receives a brief "please slow down" response.
- The reject is logged.

The owner entity (sealed tier) is subject to the same rate limits in the current implementation. This may change in a future version.

---

## Secrets Management

### Never Commit Secrets

All secrets (API keys, bot tokens, OAuth credentials) must go in `.env`, referenced in `gateway.json` via `$ENV{VAR_NAME}`. The `aionima doctor` command checks for common secret patterns in `gateway.json` and fails if any are found.

Common patterns checked:
- `sk-ant-` (Anthropic API key prefix)
- `sk-proj-` (Anthropic project key prefix)

### .env Permissions

The `.env` file must have mode `0600` (readable only by the owner). The setup wizard sets this automatically. Verify:

```bash
stat /opt/agi/.env
# Should show: -rw------- (0600)
```

Fix if wrong:

```bash
chmod 0600 /opt/agi/.env
```

### Systemd EnvironmentFile

In production, the `.env` file is loaded by systemd's `EnvironmentFile` directive in the service unit. This means secrets are passed to the process as environment variables at startup — they are never stored in the systemd unit file itself.

---

## HTTPS and TLS

The gateway does not terminate TLS by default. For production:

1. **Caddy** — if you are using Caddy for project hosting, configure it to also reverse-proxy the gateway with automatic TLS.
2. **Nginx/Caddy in front** — put a TLS-terminating reverse proxy in front of the gateway.
3. **Cloudflare Tunnel** — use `cloudflared tunnel` for end-to-end encrypted access.

Example Caddy config for proxying the gateway:

```
ai.on {
    reverse_proxy localhost:3100
}
```

Caddy automatically provisions a TLS certificate from Let's Encrypt (requires a public domain) or uses self-signed for internal domains.

---

## Channel-Level Security

Each channel has its own security considerations:

| Channel | Risk | Mitigation |
|---------|------|-----------|
| Telegram | Bot token leaks if `.env` is compromised | Revoke and regenerate via BotFather; set `dmPolicy: pairing` |
| Discord | Bot token leaks | Regenerate in Developer Portal; restrict bot to specific guilds |
| Email | OAuth refresh token grants full mailbox access | Use a dedicated Gmail account; revoke in Google Account security |
| Signal | Signal account could be used to impersonate you | Use a dedicated phone number |
| WhatsApp | Access token grants messaging on behalf of business | Use system user tokens with narrow scopes |

---

## Dashboard Authentication

For multi-user deployments, enable dashboard authentication:

```json
{
  "dashboardAuth": {
    "enabled": true,
    "jwtSecret": "$ENV{JWT_SECRET}",
    "sessionTtlMs": 86400000
  }
}
```

When enabled, the dashboard requires login. Sessions are signed JWT tokens. The `JWT_SECRET` should be a 64-character random hex string (generated by `aionima setup`).

Without `dashboardAuth` enabled, anyone who can reach the gateway HTTP endpoint (and has or can guess the `AUTH_TOKEN`) can access the dashboard. For single-user LAN deployments, this is often acceptable — the loopback exemption protects against external access.

---

## Audit Trail

All agent invocations are logged to the Chain of Accountability (COA) audit trail in the entity database. The COA log records:

- Who sent the message (entity alias, channel, timestamp)
- What the agent was asked
- What tools the agent used
- What the agent responded
- The COA fingerprint anchoring the accountability chain
- **Source IP address** of the request (HIPAA audit controls, PCI Req 10.2.2)
- **Integrity hash** forming a tamper-evident chain (PCI 10.3)

The COA Explorer in the dashboard provides a searchable view of this audit trail.

### Log Retention

Configure log retention in `gateway.json`:

```json
{
  "logging": {
    "retentionDays": 365,
    "hotRetentionDays": 90
  }
}
```

PCI DSS 10.5.1 requires at least 12 months total retention with 3 months immediately available. The defaults satisfy this requirement.

### Integrity Chain

Each COA record includes an `integrity_hash` — a SHA-256 hash of the record's fields concatenated with the previous record's hash. This creates a tamper-evident chain: modifying or deleting any historical record breaks the chain from that point forward. To verify integrity, replay the hash computation from the first entry.

---

## Encryption at Rest

Aionima supports field-level encryption for PII/PHI data stored in the SQLite database using AES-256-GCM.

### Enabling Encryption

```json
{
  "compliance": {
    "encryptionAtRest": true,
    "encryptionKey": "$ENV{ENCRYPTION_KEY}"
  }
}
```

Generate a 32-byte encryption key:

```bash
openssl rand -hex 32
```

Store it as an environment variable or TPM2-sealed credential. Encrypted values are stored with an `enc:v1:` prefix so they are distinguishable from plaintext.

### What Gets Encrypted

When enabled, sensitive entity fields (display names, channel identifiers) are encrypted before writing to the database and decrypted on read. Non-sensitive fields (IDs, timestamps, COA fingerprints) remain in plaintext for query performance.

Compliance mappings: HIPAA encryption guidance (unsecured PHI safe harbor), PCI DSS Req 3, GDPR Art 32.

---

## Multi-Factor Authentication

TOTP-based two-factor authentication (RFC 6238) is available for dashboard access.

### Enabling MFA

```json
{
  "compliance": {
    "requireMfa": true
  }
}
```

When enabled, users must enroll in MFA during their next login. The enrollment flow generates a TOTP secret, displays a QR code for authenticator apps (Google Authenticator, Authy, etc.), and provides 10 one-time recovery codes.

Compliance mappings: PCI DSS 8.4.2 (MFA for CDE access), HIPAA access controls, SOC 2 CC6.

---

## Incident Response

Aionima includes an incident tracking system for security events and breach management.

### Incident Lifecycle

Incidents follow a status workflow: **Detected** → **Investigating** → **Contained** → **Resolved** → **Closed**.

Each incident tracks:
- Severity (critical / high / medium / low / info)
- Breach classification (reportable under HIPAA, GDPR, both, or not reportable)
- Affected data types and systems
- Detection time and awareness time
- **Notification deadlines**: GDPR 72 hours from awareness, HIPAA 60 days from discovery

### Notification Clocks

When an incident is classified as reportable:
- **GDPR**: Supervisory authority must be notified within 72 hours
- **HIPAA**: Individuals must be notified within 60 days

The system tracks these deadlines and flags overdue incidents.

---

## Privacy Controls

### Right to Erasure (GDPR Art 17)

Aionima implements a multi-phase deletion process for entity data:

1. **Request** — deletion request is logged
2. **Anonymize COA** — COA records are redacted (entity references replaced with [REDACTED])
3. **Delete content** — transcripts, sessions, and message history removed
4. **Clear profile** — entity profile fields, channel accounts, verification details cleared
5. **Finalize** — entity status set to "deleted"

COA record hashes and aggregate impact scores are preserved for audit continuity.

### Consent Management

Track consent per entity per purpose:
- `data_processing` — core service functionality
- `analytics` — usage analytics
- `communications` — outbound messaging
- `third_party_sharing` — sharing data with external services

Consent is granted or revoked per purpose with a timestamp, source, and version. The system checks consent state before processing when configured.

### Data Export (GDPR Art 15/20)

Entity data can be exported as a structured JSON archive including profile data, channel accounts, message history, COA records, and impact scores.

---

## Backup & Recovery

### Automated Backups

```json
{
  "backup": {
    "enabled": true,
    "dir": "~/.agi/backups",
    "retentionDays": 30
  }
}
```

When enabled, the system performs daily SQLite backups of the entity database and marketplace database. Old backups are automatically cleaned up based on the retention period.

Compliance mappings: GDPR Art 32 (ability to restore availability), SOC 2 availability criteria.

---

## Vendor Management

Track third-party service providers and their compliance status:

- **LLM providers** (Anthropic, OpenAI, Ollama) — auto-populated from config
- **OAuth providers** (Google, GitHub) — auto-populated from identity config
- **Other processors** — manually tracked

Each vendor record tracks:
- DPA (Data Processing Agreement) signed status — required by GDPR Art 28
- BAA (Business Associate Agreement) signed status — required by HIPAA
- Compliance review status and dates — PCI DSS 12.8.4 requires annual review
- Certifications (SOC 2, HIPAA, PCI, etc.)

---

## Session Management

### Server-Side Session Tracking

All dashboard sessions are tracked server-side with:
- Session ID and token hash
- Source IP and user agent
- Creation and expiration timestamps
- Revocation status

### Session Revocation

Sessions can be revoked individually or all sessions for an entity can be force-terminated. Revoked tokens are rejected on subsequent requests.

### API Key Lifecycle

API keys support:
- Creation with optional expiration date
- Last-used timestamp tracking
- Revocation (immediate invalidation)
- Label-based identification

---

## Compliance Self-Assessment

Run `aionima doctor` to check your compliance posture. The doctor command verifies:

- Core infrastructure (config, database, systemd, deploy directory)
- Authentication and secrets management
- Multi-repo integrity (PRIME, Marketplace, ID service)
- Plugin system health
- Hosting infrastructure (if enabled)
- Gateway reachability and dashboard build status

Use `aionima doctor --json` for machine-readable output suitable for automated compliance monitoring.

---

## Framework Coverage

| Framework | Key Requirements | Aionima Controls |
|-----------|-----------------|-----------------|
| **SOC 2** | Trust Services Criteria (security, availability, confidentiality) | COA audit trail, access controls, backup/recovery, change management |
| **HIPAA** | Administrative, physical, technical safeguards for ePHI | Encryption at rest, audit logging, breach notification tracking, BAA management |
| **PCI DSS** | 12 principal requirements for payment data | MFA, log retention (365d/90d), encryption, vendor monitoring |
| **GDPR** | Data protection principles, rights fulfillment, breach notification | Right to erasure, consent management, data export, 72h notification clock |
| **NIST SP 800-53** | Security and privacy control catalog | Mapped to AC, AU, CM, IR, SC families |
| **ISO 27001** | Information Security Management System | Risk-driven controls, audit, continuous improvement |

---

## Security Scanning

Aionima includes a built-in security scanning system that performs automated vulnerability detection on your codebase and configuration. Scans can be triggered from the dashboard or programmatically via the API.

### Scan Types

| Type | What It Checks |
|------|---------------|
| **SAST** | Static analysis — XSS, SQL injection, command injection, path traversal, SSRF, eval(), prototype pollution |
| **SCA** | Supply chain — dependency vulnerabilities from lockfiles matched against known CVE advisories |
| **Secrets** | Credential detection — API keys, tokens, passwords, private keys in source files |
| **Config** | Configuration hardening — .env exposure, debug mode, Dockerfile root user, missing lockfiles |

### Running a Scan

From the dashboard:
1. Navigate to a code-based project's **Security** tab
2. Click **Full Scan** to run all scan types, or click individual types (SAST, SCA, Secrets, Config)
3. Results appear in the findings list below

For system-wide scans:
1. Go to **System > Security** in the backend sidebar
2. Click **Run System Scan** to scan the entire production codebase

### Findings

Each finding includes:
- **Severity** — Critical, High, Medium, Low, or Info
- **Check ID** — The detection rule that flagged it (e.g., `SAST-XSS-01`, `SCA-CVE-2024-1234`)
- **Evidence** — File path, line number, code snippet, or dependency info
- **Remediation** — How to fix it, with effort estimate
- **Standards mapping** — CWE, OWASP Top 10, NIST SP 800-53 references

### Finding Status

Manage findings by setting their status:
- **Open** — Unaddressed (default)
- **Acknowledged** — Reviewed, accepted as known risk
- **Mitigated** — Fix applied
- **False Positive** — Incorrectly flagged

### Remediation SLAs

| Severity | Target Remediation |
|----------|-------------------|
| Critical | 24-72 hours |
| High | 7 days |
| Medium | 30 days |
| Low | 90 days / best effort |

### Security Tab (Code Projects Only)

The Security tab appears only for projects whose type has `hasCode: true` (web, app, monorepo, and ops projects). Literature, media, and administrative projects do not show this tab.

### Extending with Custom Scanners

Plugins can register additional scan providers using `api.registerScanProvider()` with the `defineScan()` SDK builder. Custom scanners receive the same config and context as built-in scanners and their findings are stored alongside built-in results.

### API Endpoints

All security API endpoints require private network access.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/security/providers` | GET | List available scan providers |
| `/api/security/scans` | GET | Scan history |
| `/api/security/scans` | POST | Trigger a new scan |
| `/api/security/scans/:id` | GET | Get scan run details |
| `/api/security/findings` | GET | Query findings (filterable) |
| `/api/security/findings/:id/status` | PUT | Update finding status |
| `/api/security/summary` | GET | Aggregate security posture |
