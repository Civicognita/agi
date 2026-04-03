# Contributing Mode

Contributing Mode (formerly Dev Mode) lets you switch Aionima between production repositories (Civicognita) and personal fork directories for development work.

## Core Repos

| Repo | Primary (Civicognita) | Fork (default) |
|------|----------------------|----------------|
| AGI | `Civicognita/agi` | `wishborn/agi` |
| PRIME | `Civicognita/aionima` | `wishborn/aionima` |
| BOTS | `Civicognita/bots` | `wishborn/bots` |

## How It Works

Contributing mode uses **separate directories** for each repo rather than switching git remotes. This means:

| Mode | PRIME Directory | BOTS Directory |
|------|----------------|----------------|
| Production | `/opt/aionima-prime` | `/opt/aionima-bots` |
| Contributing | `/opt/aionima-prime_dev` | `/opt/aionima-bots_dev` |

When you toggle contributing mode, Aionima changes which directory it reads PRIME and BOTS from. The production directories are never modified while in contributing mode.

## Setup

### 1. Clone Contributing Repositories

```bash
# Clone your personal forks
git clone git@github.com:wishborn/aionima.git /opt/aionima-prime_dev
git clone git@github.com:wishborn/bots.git /opt/aionima-bots_dev
```

### 2. Configure Custom Paths (Optional)

If your contributing directories are in non-default locations, add them to `aionima.json`:

```json
{
  "dev": {
    "enabled": false,
    "agiRepo": "git@github.com:your-user/agi.git",
    "primeRepo": "git@github.com:your-user/aionima.git",
    "botsRepo": "git@github.com:your-user/bots.git",
    "primeDir": "/opt/aionima-prime_dev",
    "botsDir": "/opt/aionima-bots_dev"
  }
}
```

## Using Contributing Mode

Navigate to **Settings > Gateway > Contributing** tab in the dashboard.

### Toggle

The Contributing Mode toggle switches which directories Aionima reads from:

- **ON**: Reads PRIME from `dev.primeDir`, BOTS from `dev.botsDir`
- **OFF**: Reads PRIME from `prime.dir`, BOTS from `bots.dir`

After toggling, the config file is updated and a **restart is required** for path changes to take effect.

### Sacred Projects

When Contributing mode is on, the Projects page shows a **Sacred Projects** section at the top (AGI, PRIME, BOTS, ID). These cards use a gold star + indigo card and are immutable (no rename/delete). If a repo is missing, the card shows **Not provisioned** until it’s created.

### Repo Status Cards

Three cards show the current state of each repo:
- Current remote URL
- Branch
- Entry count (for PRIME corpus)
- Green dot indicates owner fork, grey dot indicates primary

### COA Fork Tracking

When contributing mode is active, all COA (Chain of Accountability) audit records include a `fork_id` field identifying which fork created the record. This provides traceability for work done in development vs production.

## API

### GET /api/dev/status

Returns the current contributing mode state and repo information.

### POST /api/dev/switch

Toggle contributing mode on or off. Requires `{ "enabled": true|false }` in the request body.

Response includes the directories that will be active after restart:

```json
{
  "ok": true,
  "enabled": true,
  "primeDir": "/opt/aionima-prime_dev",
  "botsDir": "/opt/aionima-bots_dev",
  "note": "Restart required for path changes to take effect"
}
```
