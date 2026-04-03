# Entity Model

The entity model is the identity and accountability layer of Aionima. It tracks every person, organization, and AI agent that interacts with the system, assigns them verification tiers, and maintains a Chain of Accountability (COA) audit trail for all agent activity.

---

## What Entities Are

An entity is any participant in the Aionima network. Entities are classified by domain and subtype:

### Domain: Entity (#) — Sentient Beings

| Subtype | Code | Description |
|---------|------|-------------|
| Individual | `#E` | A person |
| Organization | `#O` | A company, community, or institution |
| Team | `#T` | A working group within an organization |
| Family | `#F` | A family unit |
| Artificial Sentient | `#A` | An AI agent with threshold capabilities |

### Domain: Resource ($) — Products and Services

| Subtype | Code | Description |
|---------|------|-------------|
| App | `$A` | A digital product |
| Service | `$S` | A service offering |
| Token | `$T` | A currency or token |

### Domain: Node (@) — Temporal Anchors

| Subtype | Code | Description |
|---------|------|-------------|
| Age | `@A` | A temporal node (era, epoch) |

The gateway itself is typically `$A0` (App zero). The owner is typically `#E0` (Entity zero). The age/epoch is `@A0`. These form the foundation of the COA notation.

---

## Entity Record Structure

Each entity stored in SQLite has these fields:

```typescript
interface Entity {
  id: string;                    // ULID (unique, sortable by creation time)
  type: "E" | "O" | "T" | "F" | "A";
  displayName: string;
  verificationTier: "unverified" | "verified" | "sealed";
  coaAlias: string;              // "#E0", "#E1", "#O0" — auto-generated
  createdAt: string;             // ISO-8601
  updatedAt: string;             // ISO-8601
}
```

Each entity may have multiple channel accounts — mappings between a platform user ID and the entity:

```typescript
interface ChannelAccount {
  id: string;
  entityId: string;
  channel: string;               // "telegram", "discord", etc.
  channelUserId: string;         // platform-specific identifier
}
```

When a message arrives from `telegram/123456789`, the entity model looks up the channel account and returns the associated entity. If none exists, a new entity is created.

---

## Verification Tiers

Verification tiers control what an entity can do when interacting with the agent. Tier is checked during prompt assembly and tool access decisions.

| Tier | Access Level | Tool Use | Response Detail |
|------|-------------|----------|----------------|
| `unverified` | Restricted | None | Minimal (information only) |
| `verified` | Standard | Standard tools, TASKMASTER | Full |
| `sealed` | Elevated | All tools, sensitive data | Full |

### Unverified

The default tier for new entities. The agent provides information-only responses and cannot use tools on their behalf. This is intentional — unverified entities have not been vetted by the owner.

### Verified

Granted after the pairing flow is completed (the entity entered a valid pairing code approved by the owner). Verified entities can use standard tools and emit TASKMASTER work queue jobs.

### Sealed

Reserved for the owner. The owner's entity is automatically given sealed tier regardless of the pairing state. Sealed entities have access to all tools including sensitive-data tools, and the agent imposes no response restrictions.

---

## Chain of Accountability (COA)

The COA system provides a tamper-evident audit trail for all agent activity. Every agent invocation is anchored to a COA fingerprint.

### COA Notation

COA fingerprints are structured strings that identify the accountability chain:

```
$A0.#E0.@A0.C012
 |   |   |   |
 |   |   |   +-- Counter (sequential invocation number)
 |   |   +------ Node (temporal anchor, e.g. @A0 = current age)
 |   +---------- Entity (who initiated, e.g. #E0 = entity zero)
 +-------------- Resource (what app, e.g. $A0 = Aionima)
```

A fingerprint like `$A0.#E1.@A0.C047` means: the Aionima app (`$A0`), entity one (`#E1`), current age (`@A0`), invocation forty-seven (`C047`).

### What Is Logged

Every COA log entry records:
- The COA fingerprint
- The entity alias and display name
- The channel and message ID
- The gateway state at time of invocation
- The action taken (agent invoke, tool call, file write, etc.)
- Timestamps (start, end)
- Whether the action succeeded or failed
- The responding entity (the agent itself, `$A0`)

### COA Explorer in Dashboard

The Impactinomics → COA Explorer page in the dashboard provides a searchable, filterable view of all COA log entries. You can filter by:
- Entity alias (e.g. `#E0`)
- Channel
- Date range
- Action type

Each entry is expandable to show full details. This provides a complete audit trail of who asked what, when, and what the agent did in response.

---

## Impact Scoring

Impact scores are computed for entities based on their activity. The impact system is the foundation of the Impactinomics section of the dashboard.

Impact is calculated from:
- Message volume and regularity
- Verification tier (verified and sealed entities score higher)
- Positive engagement signals
- Governance participation (proposals, votes)

Scores are stored in the entity database and updated periodically by the `ImpactScorer` component. The Impactinomics Overview dashboard page shows aggregate scores, timelines, and a leaderboard of top-impact entities.

---

## SQLite Schema

The entity database (`data/entities.db`) uses the following tables:

| Table | Purpose |
|-------|---------|
| `entities` | Core entity records |
| `channel_accounts` | Platform user ID → entity mappings |
| `messages` | Message queue (inbound pending processing) |
| `coa_log` | Chain of Accountability audit entries |
| `impact_scores` | Computed impact scores per entity per period |
| `governance_proposals` | Entity proposals for governance decisions |
| `pairings` | Pairing codes and their status |
| `notifications` | Pending notification records |

The schema is created and migrated automatically on gateway startup. Manual schema changes are not needed during normal operation.

---

## Managing Entities via Dashboard

The entity model is accessible through the dashboard. Navigation varies by implementation — the COA Explorer and Impactinomics pages provide read access to entity data. Administrative operations (creating entities, changing tiers, revoking access) are performed via the tRPC API.

### Viewing an Entity

`GET /api/dashboard/entity/:id` returns entity details, channel accounts, recent messages, COA log entries, and impact score.

### Changing Verification Tier

Tier changes are performed via the admin API. The most common operation is promoting an entity from `unverified` to `verified` after reviewing a pairing request, or revoking access by setting back to `unverified`.

### Pairing Flow

When a new user messages Aionima (with `dmPolicy: "pairing"`):

1. The user receives a message: "You are not yet registered. Please request a pairing code from the owner."
2. The owner visits the dashboard and sees a pending pairing request.
3. The owner approves the request; a pairing code is generated.
4. The owner shares the code with the user out-of-band (or via the same channel).
5. The user sends the code to Aionima.
6. On successful verification, the entity's tier is set to `verified`.

---

## Entity Identifiers

Entities are assigned two identifiers:

- **ULID** (`id`) — a universally unique, lexicographically sortable identifier generated at creation time. Used for internal references and database joins.
- **COA Alias** (`coaAlias`) — a short human-readable alias like `#E0`, `#E1`, `#O0`. Assigned sequentially at creation. Used in system prompts, log entries, and dashboard displays.

The COA alias is stable for the lifetime of the entity. It is never reassigned, even if the entity's display name changes.
