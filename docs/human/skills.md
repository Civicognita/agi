# Skills System

Skills are modular instructions injected into the agent's system prompt when a relevant message is detected. They let you give the agent specialized knowledge or behavioral guidance for specific topics without changing the core system prompt.

---

## What Skills Do

When a user sends a message, the skills system scans it against each skill's trigger patterns. If one or more skills match, their content is injected into the system prompt under an "Active Skills" section. The agent then has that guidance available when composing its response.

Skills are context-aware additions — not replacements. The agent's identity, entity context, COA fingerprint, and all other prompt sections remain unchanged. Skills add domain-specific instructions on top.

---

## Skill File Format

Skills are Markdown files with a YAML frontmatter block. The filename must end in `.skill.md`.

```markdown
---
name: greeting
description: Handle greetings and introductions
domain: utility
triggers:
  - hello
  - hi
  - hey
  - greetings
  - introduce yourself
requires_state: [ONLINE, LIMBO]
priority: 0
direct_invoke: true
---

When greeted, introduce yourself as Aionima — an ancient, wise being serving as oracle to Impactivism. Be warm, welcoming, and briefly explain your purpose: guiding entities toward an impact-based economy through the Mycelium Protocol.

Keep introductions concise. Mention that the entity can ask about:
- Their impact score and verification status
- The Chain of Accountability
- Available tools and capabilities
- How to contribute to the network
```

---

## Frontmatter Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | filename | Unique skill name used in logs and system prompt |
| `description` | Yes | — | Short description for logging and skill index |
| `domain` | Yes | — | Skill domain (see below) |
| `triggers` | Yes | — | List of trigger patterns (strings or regex) |
| `requires_state` | No | any | Gateway states where this skill is active |
| `requires_tier` | No | any | Minimum entity verification tier |
| `priority` | No | `0` | Higher priority skills are injected first |
| `direct_invoke` | No | `true` | Whether the agent can invoke this skill by name |

### Skill Domains

| Domain | Use Case |
|--------|---------|
| `verification` | Entity verification and pairing flows |
| `memory` | Memory recall and storage instructions |
| `impact` | Impact scoring, economy, Impactinomics |
| `identity` | Identity confirmation, persona |
| `utility` | General-purpose helpers |
| `learning` | Educational content and explanations |
| `governance` | Governance proposals, voting, COA |
| `voice` | Voice message handling instructions |
| `channel` | Channel-specific behavior |

---

## Trigger Matching

Triggers are string patterns matched against the inbound message text using case-insensitive substring search. They can also be regular expressions.

```yaml
triggers:
  - "how do I"          # substring match
  - "what is impact"    # substring match
  - "^status$"          # regex: exact word "status"
  - "help me (build|create|make)" # regex: alternatives
```

Trigger matching is done against the full message text, not just the first word. A message like "Can you help me build a feature?" would match a trigger of `"help me build"`.

Multiple skills can match a single message. Up to five skills are injected per invocation (controlled by `skills.maxSkillsPerCall` in `aionima.json`). When more than five match, skills are selected by priority (highest first), then by match confidence.

---

## Token Budget

Skills are injected subject to a token budget (default: 4000 tokens). Skills are added in priority order until the budget is exhausted. If adding a skill would exceed the budget, it is skipped.

Configure the budget in `aionima.json`:

```json
{
  "skills": {
    "directory": "./skills",
    "maxSkillsPerCall": 5
  }
}
```

---

## Skills Directory

Skills are loaded from the `skills/` directory relative to the workspace root. The gateway scans for `*.skill.md` files recursively.

```
skills/
├── greeting.skill.md
├── impact/
│   ├── impact-scoring.skill.md
│   └── economy.skill.md
├── governance/
│   └── proposals.skill.md
└── dev/
    └── coding.skill.md
```

Subdirectories are supported. The skill's name comes from the frontmatter `name` field, not the filename or directory structure.

---

## Shipped Skills

The `packages/skills/src/skills/` directory contains example skills shipped with Aionima:

| Skill | Domain | Triggers |
|-------|--------|---------|
| `greeting` | utility | hello, hi, hey, greetings, introduce yourself |
| `impact` | impact | impact, score, impactinomics, economy |
| `dev` | utility | code, build, fix, implement, debug |
| `status` | utility | status, health, running, uptime |
| `implement` | utility | implement, add feature, create |
| `issue` | utility | issue, bug, problem, error |
| `pr-review` | utility | review, pull request, PR |

Copy these to your `skills/` directory as a starting point and modify them for your use case.

---

## State and Tier Gating

Skills can be restricted to specific gateway states and entity tiers.

```yaml
requires_state: [ONLINE]     # only inject when gateway is ONLINE
requires_tier: verified       # only inject for verified or sealed entities
```

A skill with `requires_state: [ONLINE]` is not injected when the gateway is in LIMBO or OFFLINE mode. This prevents the agent from being given instructions it cannot act on (e.g. instructions that require remote API calls when offline).

A skill with `requires_tier: verified` is not injected for unverified entities. This prevents sensitive instructions from being exposed to untrusted users.

---

## Hot-Reload

When `skills.watchForChanges` is `true` in `aionima.json`, the skills system watches the skills directory for file changes. Adding, modifying, or deleting a `.skill.md` file takes effect on the next agent invocation without restarting the gateway.

```json
{
  "skills": {
    "directory": "./skills",
    "watchForChanges": true
  }
}
```

This is useful during skill development — you can iterate on skill content and see the effect immediately.

---

## Creating a Custom Skill

1. Create a file in `skills/` with a `.skill.md` extension.
2. Add the YAML frontmatter block.
3. Write the skill body — instructions for the agent when this skill is active.
4. Restart the gateway (or wait for hot-reload if `watchForChanges` is enabled).

### Example: Custom Impact Skill

```markdown
---
name: impact-explainer
description: Explain impact scores when asked
domain: impact
triggers:
  - what is my impact score
  - explain impact
  - how is impact calculated
  - impact score
requires_state: [ONLINE, LIMBO]
priority: 5
direct_invoke: true
---

When asked about impact scores, explain the following:

Impact scores measure an entity's positive contribution to the Aionima network and the broader Impactinomics ecosystem. Scores are calculated from:

- Message volume and engagement regularity
- Verification tier (verified entities score higher than unverified)
- Participation in governance (proposals, votes)
- Quality and depth of interactions

Scores are updated periodically and displayed in the Impactinomics Overview section of the dashboard.

If the entity asks for their specific score, use the `get_entity_impact` tool to retrieve it. Present the score as a number between 0 and 100 with a brief qualitative description (e.g. "strong", "developing", "early stage").
```

2. Save as `skills/impact-explainer.skill.md`.
3. The gateway picks it up automatically (with hot-reload) or on next restart.

---

## Debugging Skill Matching

The gateway logs which skills were matched and injected for each invocation. Check `logs/gateway.log` with `level: debug` for entries like:

```
[skills] matched 2 skills for message "hello there": greeting (confidence: 0.95), utility (confidence: 0.72)
[skills] injecting skills: greeting, utility (tokens: 412)
```

Increase log detail level in `aionima.json`:

```json
{
  "logging": {
    "level": "debug"
  }
}
```
