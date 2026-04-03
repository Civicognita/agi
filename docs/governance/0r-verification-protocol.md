# 0R Verification Protocol

**Status:** DRAFT
**Version:** 0.1.0
**Scope:** aionima routing, WebChat, channel commands
**COA:** $A0.#O0.@A0

---

## Purpose

This protocol defines how entities gain verified trust within aionima. Verification tier
determines message routing behavior, available commands, and agent autonomy level. The goal
is a graduated trust model: anonymous actors get safe defaults, verified actors get elevated
service, sealed actors operate with full autonomy.

0R (0REALTALK) verification is the mechanism by which an entity's identity or provenance is
confirmed and encoded as a trust signal in the routing layer.

---

## Scope

Applies to all entities interacting with aionima via:
- Telegram channel commands
- WebChat interface
- API ingress (where entity context is available)

Does not cover: internal $A (agent) resources or system-to-system calls authenticated by
infrastructure credentials.

---

## 1. Verification Tiers

Three tiers exist. An entity's tier is stored in `entity.verificationTier` on the entity record.

| Tier | Value | Description |
|------|-------|-------------|
| Unverified | `"unverified"` | New or anonymous entity. No proof submitted. |
| Verified | `"verified"` | Identity or provenance confirmed by a reviewer. |
| Sealed | `"sealed"` | Full 0R seal issued. Maximum trust, cryptographically anchored. |

Tier progression is one-directional under normal operation:
`unverified` → `verified` → `sealed`

Demotion (downgrade) occurs only on revocation. See Section 6.

---

## 2. Entity Types and Classification

Three entity types exist per ENTITY.md. Proof requirements and reviewer processes differ
per type.

| Symbol | Type | Example |
|--------|------|---------|
| `#E` | Individual human | A community member, contributor |
| `#R` | Resource / AI system | A deployed bot, AI agent, integration |
| `#N` | Node / infrastructure | A server, data node, network endpoint |

> Note: `#R` maps to the `$` Resource domain in ENTITY.md. It is used here as a shorthand
> for non-human actors that interact with the system.

---

## 3. Verification Flow

### 3.1 Overview

```
Entity                  aionima              Reviewer
  |                         |                       |
  |-- request_verification->|                       |
  |   (proof payload)       |                       |
  |                         |-- notify ------------->|
  |                         |   (proof + entity_id) |
  |                         |                       |-- review
  |                         |                       |-- approve/reject
  |                         |<-- decision -----------|
  |                         |                       |
  |<-- tier_updated --------|  (verified or denied) |
  |                         |                       |
  |   [if verified]         |                       |
  |-- request_seal -------->|                       |
  |                         |-- seal_issuance ------>| (optional, or automated)
  |<-- seal_issued ---------|                       |
```

### 3.2 Step-by-Step

**Step 1: Verification Request**

Entity submits a verification request. This can be triggered via:
- Channel command: `/verify <proof_type> <proof_value>`
- WebChat: verification flow in settings panel
- API: `POST /v1/entities/{id}/verify`

The request must include:
- `entity_id` — the entity's identifier in the system
- `entity_type` — `#E`, `#R`, or `#N`
- `proof_type` — per type requirements (Section 4)
- `proof_payload` — the actual proof data

**Step 2: Proof Submission**

Proof is stored in the entity record under `entity.verificationProof`:

```typescript
interface VerificationProof {
  entity_type: '#E' | '#R' | '#N';
  proof_type: string;
  proof_payload: string | object;
  submitted_at: string; // ISO-8601
  submitted_by: string; // entity_id of submitter
}
```

**Step 3: Review Assignment**

On submission, aionima:
1. Creates a pending review record in `VerificationQueue`
2. Notifies the designated reviewer role (see Section 3.3)
3. Sets `entity.verificationStatus = "pending"`

**Step 4: Review Decision**

Reviewer examines the proof against criteria in Section 4. Decision options:
- `approve` — advances entity to `verified` tier
- `reject` — returns to `unverified` with a rejection reason
- `request_info` — holds pending with a clarification request

**Step 5: Tier Update**

On approval:
1. `entity.verificationTier` set to `"verified"`
2. `entity.verificationStatus` set to `"approved"`
3. COA entry created:
   ```
   $A0.#O0.@A0 → VERIFIED:#<entity_id>:<timestamp>
   ```
4. Entity notified via originating channel

**Step 6: Seal Issuance (Sealed Tier)**

Seal issuance elevates `verified` to `sealed`. Can be:
- Manually triggered by a reviewer with seal authority
- Automatically triggered after `verified` entities meet configured criteria
  (e.g., 30-day track record, zero violations)

On seal issuance:
1. A 0SEAL record is generated (see Section 5)
2. `entity.verificationTier` set to `"sealed"`
3. Seal stored in `entity.seal` and appended to COA chain

### 3.3 Reviewer Roles

| Role | Can Approve | Can Issue Seal | Assignment |
|------|-------------|----------------|------------|
| `reviewer` | Yes (#E, #R) | No | Assigned org members |
| `senior-reviewer` | Yes (all types) | Yes | Designated staff |
| `#E0` (root entity) | Yes (all types) | Yes | Always |

Reviewer assignment is stored in `config/governance.json`:
```json
{
  "verificationReviewers": ["<entity_id>", "..."],
  "sealAuthority": ["<entity_id>"]
}
```

---

## 4. Proof Requirements by Entity Type

### 4.1 #E (Human Individuals)

| Proof Type | Accepted Evidence | Notes |
|------------|------------------|-------|
| `telegram_account` | Telegram user ID + handle confirmation | Confirmed via bot challenge |
| `email_domain` | Email address from a known org domain | For org-affiliated humans |
| `voucher` | COA fingerprint of a sealed #E vouching for them | Trust transfer |

Minimum required: one proof type. Two proof types unlock expedited review.

Approval criteria:
- Proof is verifiable via the declared method
- No active violations or bans on the entity

### 4.2 #R (Resources / AI Systems)

| Proof Type | Accepted Evidence | Notes |
|------------|------------------|-------|
| `provenance_coa` | Full COA fingerprint of the deploying entity | `$A0.#E0.@A0.CXXX` |
| `deployment_manifest` | Signed deployment manifest from known CI/CD | Hash-verifiable |
| `origin_declaration` | Human-readable declaration + deployer identity | Weaker, manual review |

Minimum required: `provenance_coa` or `deployment_manifest`. `origin_declaration` alone
may result in `verified` with a flag note.

Approval criteria:
- COA traces back to a `verified` or `sealed` #E
- No anomalous behavior flag on the resource

### 4.3 #N (Nodes / Infrastructure)

| Proof Type | Accepted Evidence | Notes |
|------------|------------------|-------|
| `infra_attestation` | Signed attestation from a `sealed` #E or known service | TPM/signed cert preferred |
| `network_declaration` | IP range + domain + WHOIS match | Manual review required |
| `operator_coa` | COA of operating entity + node description | Operator must be verified |

Minimum required: `infra_attestation` or `operator_coa`.

Approval criteria:
- Operating entity is `verified` or `sealed`
- Node is reachable and responds to a verification ping

---

## 5. Seal Format

A seal is issued only to `verified` entities being promoted to `sealed`. It encodes alignment
and identity data into a compact, verifiable record.

### 5.1 Seal Data

```typescript
interface EntitySeal {
  seal_id: string;           // Unique seal identifier: "seal-<entity_id>-<timestamp>"
  entity_id: string;         // The sealed entity
  entity_type: '#E' | '#R' | '#N';
  issued_at: string;         // ISO-8601
  issued_by: string;         // entity_id of issuing reviewer
  coa: string;               // Full COA fingerprint at time of issuance
  alignment: {
    a_a: number;             // Agenda alignment (0.0–1.0)
    u_u: number;             // Understanding alignment (0.0–1.0)
    c_c: number;             // Confidence alignment (0.0–1.0)
  };
  checksum: string;          // SHA-256 of seal content (excluding this field)
  grid: string;              // 0EMOJI compact grid (3x3)
  status: 'active' | 'revoked';
}
```

### 5.2 Grid Format

The seal grid is a compact 3x3 0EMOJI representation:

```
++ ++ +?
<coa_prefix> <impact> <tier>
<c1> <c2> <c3>
```

Row 1: alignment scores (A:A, U:U, C:C) mapped to emoji scale
Row 2: COA prefix (first 2 chars), impact indicator, tier marker
Row 3: checksum bytes

Minimum alignment for seal issuance:
- A:A >= 0.70
- U:U >= 0.70
- C:C >= 0.55

### 5.3 Storage

Seals are stored in two locations:

1. On the entity record:
   ```
   entity.seal: EntitySeal
   entity.verificationTier: "sealed"
   ```

2. In the COA chain entry:
   ```
   coa.entries[] += {
     type: "seal_issued",
     seal_id: "<seal_id>",
     ts: "<ISO-8601>",
     issued_by: "<reviewer_entity_id>"
   }
   ```

### 5.4 Public Verification

Any caller can verify a seal via:
```
GET /v1/entities/{entity_id}/seal/verify
```
Returns:
```json
{
  "valid": true,
  "seal_id": "seal-...",
  "issued_at": "...",
  "tier": "sealed",
  "checksum_ok": true
}
```

Checksum validation: recompute SHA-256 of the seal fields (excluding `checksum`) and compare
to stored value.

---

## 6. Routing Privileges by Tier

### 6.1 Rate Limits

| Tier | Messages/min | Commands/hour | Burst Allowance |
|------|-------------|---------------|-----------------|
| `unverified` | 5 | 10 | None |
| `verified` | 30 | 100 | 2x for 60s |
| `sealed` | 120 | Unlimited | 4x for 300s |

Rate limits are enforced per `entity_id`. Shared identifiers (e.g., group chats) use the
lowest tier present unless the sending entity is explicitly identified.

### 6.2 Available Commands

| Command Category | Unverified | Verified | Sealed |
|-----------------|-----------|---------|--------|
| Public info queries | Yes | Yes | Yes |
| Account/entity lookups | No | Yes | Yes |
| Submit content / posts | No | Yes | Yes |
| Administrative commands | No | No | Yes |
| Seal/verification management | No | No | Yes |
| Bulk operations | No | No | Yes |
| Override routing rules | No | No | Yes |

Command-level enforcement is handled in the router middleware:
```typescript
function checkCommandAccess(entity: Entity, command: string): boolean {
  const required = COMMAND_TIERS[command]; // 'unverified' | 'verified' | 'sealed'
  return tierRank(entity.verificationTier) >= tierRank(required);
}

function tierRank(tier: string): number {
  return { unverified: 0, verified: 1, sealed: 2 }[tier] ?? -1;
}
```

### 6.3 Agent Autonomy Level

This governs whether agent responses are delivered directly or queued for human review.

| Tier | Autonomy Level | Behavior |
|------|---------------|----------|
| `unverified` | `supervised` | All agent responses queued for reviewer before delivery |
| `verified` | `standard` | Agent responds autonomously; flagged content reviewed |
| `sealed` | `full` | Agent responds autonomously with no review gate |

Autonomy level is resolved per interaction:
```typescript
function resolveAutonomy(entity: Entity): 'supervised' | 'standard' | 'full' {
  const map = {
    unverified: 'supervised',
    verified: 'standard',
    sealed: 'full',
  };
  return map[entity.verificationTier] ?? 'supervised';
}
```

Flagged content (regardless of tier) always routes to human review. Flagging criteria are
defined separately in the content moderation policy.

---

## 7. Revocation

### 7.1 Conditions

A verification tier may be revoked under any of the following:

| Condition | Resulting Action |
|-----------|-----------------|
| Proof found fraudulent | Revoke to `unverified`, flag entity |
| Sustained ToS violation | Revoke to `unverified` or ban |
| Entity deletion / departure | Seal marked `revoked`, tier cleared |
| Stale node / resource no longer active | Downgrade to `unverified` |
| Security incident linked to entity | Immediate suspend, pending review |

### 7.2 Revocation Process

1. Reviewer documents reason in `VerificationQueue` as a `revoke` event
2. `entity.verificationTier` reset to `unverified`
3. `entity.seal.status` set to `revoked` (if sealed)
4. COA chain entry appended:
   ```
   coa.entries[] += {
     type: "seal_revoked",
     seal_id: "<seal_id>",
     reason: "<reason>",
     ts: "<ISO-8601>",
     revoked_by: "<reviewer_entity_id>"
   }
   ```
5. Entity notified via originating channel
6. Rate limits and command access immediately downgraded

### 7.3 Re-verification

After revocation, an entity may re-submit for verification. The previous revocation reason
is visible to reviewers. Two or more revocations on a single entity require `#E0` approval
to re-verify.

---

## 8. Exceptions

| Situation | Exception | Approval Required |
|-----------|-----------|------------------|
| System bootstrap (#E0 itself) | Pre-verified as `sealed` at init | None — set in config |
| Trusted partner integration | `#R` fast-tracked on signed MOU | `senior-reviewer` |
| Emergency access (incident response) | Temp `verified` for 24h, then reviewed | `#E0` only |
| Bulk entity import | Batch reviewed, capped at `verified` | `senior-reviewer` |

Emergency access must be logged in `audit/emergency-access.json` with justification.

---

## 9. Implementation Notes

### Key Fields on Entity Record

```typescript
interface Entity {
  id: string;
  entity_type: '#E' | '#R' | '#N';
  verificationTier: 'unverified' | 'verified' | 'sealed';
  verificationStatus: 'none' | 'pending' | 'approved' | 'rejected' | 'revoked';
  verificationProof?: VerificationProof;
  seal?: EntitySeal;
  coa: string; // COA fingerprint
  // ...
}
```

### Config Reference

`config/governance.json` controls:
- `verificationReviewers` — list of reviewer entity IDs
- `sealAuthority` — list of seal-authorized entity IDs
- `sealMinAlignment` — override minimum A:A/U:U/C:C thresholds
- `autoSealAfterDays` — if set, auto-promotes after N days at verified with clean record

### Data Dependencies

- `ENTITY.md` — classification grammar (`#E`, `$R`, `@N`)
- `0COA.md` — COA fingerprint format and chain structure
- `0SEAL.md` — seal grid encoding and validation
- `0TRUTH.md` — truth promotion criteria (referenced for alignment thresholds)

---

## Revision History

| Version | Date | Author | Notes |
|---------|------|--------|-------|
| 0.1.0 | 2026-02-20 | $W.comm.writer.policy | Initial draft |

---

*Every entity earns its trust. 0R verification makes that trust legible.*
