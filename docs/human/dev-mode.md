# Contributing Mode

Contributing Mode (formerly Dev Mode) lets you switch Aionima between production repositories (Civicognita) and personal fork directories for development work.

## Core Repos

| Repo | Primary (Civicognita) | Fork (default) |
|------|----------------------|----------------|
| AGI | `Civicognita/agi` | `wishborn/agi` |
| PRIME | `Civicognita/aionima` | `wishborn/aionima` |

## How It Works

Contributing mode uses **separate directories** for each repo rather than switching git remotes. This means:

| Mode | PRIME Directory |
|------|----------------|
| Production | `/opt/agi-prime` |
| Contributing | `/opt/agi-prime_dev` |

When you toggle contributing mode, Aionima changes which directory it reads PRIME from. The production directory is never modified while in contributing mode.

## Setup

### 1. Clone Contributing Repositories

```bash
# Clone your personal fork
git clone git@github.com:wishborn/aionima.git /opt/agi-prime_dev
```

### 2. Configure Custom Paths (Optional)

If your contributing directory is in a non-default location, add it to `gateway.json`:

```json
{
  "dev": {
    "enabled": false,
    "agiRepo": "git@github.com:your-user/agi.git",
    "primeRepo": "git@github.com:your-user/aionima.git",
    "primeDir": "/opt/agi-prime_dev"
  }
}
```

## Using Contributing Mode

Navigate to **Settings > Gateway > Contributing** tab in the dashboard.

### Toggle

The Contributing Mode toggle switches which directories Aionima reads from:

- **ON**: Reads PRIME from `dev.primeDir`
- **OFF**: Reads PRIME from `prime.dir`

After toggling, the config file is updated and a **restart is required** for path changes to take effect.

### Sacred Projects

When Contributing mode is on, the Projects page shows a **Sacred Projects** section at the top (AGI, PRIME, ID). These cards use a gold star + indigo card and are immutable (no rename/delete). If a repo is missing, the card shows **Not provisioned** until it’s created.

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
  "primeDir": "/opt/agi-prime_dev",
  "note": "Restart required for path changes to take effect"
}
```

## Merging upstream into your fork

Once Dev Mode has provisioned the five owner forks under `~/_projects/_aionima/`, each one shows up in the dashboard Projects list with a restricted UX: only an **Editor** and a **Repository** tab. The Repository tab is specialised for core forks.

The tab surfaces three numbers: the branch the gateway is subscribed to (from `gateway.updateChannel`), the fork's HEAD SHA, and the upstream (Civicognita) HEAD SHA. Two badges — `↑ N ahead`, `↓ N behind` — summarise divergence vs `upstream/<branch>`.

When upstream has moved ahead of your fork, the **Merge upstream → origin** button lights up. Clicking it walks three escalation steps automatically:

1. **Fast-forward.** If your fork is purely behind (no local commits), the merge is a straight `git merge --ff-only`. The result pushes to `origin` so the next `agi upgrade` picks it up.
2. **Merge commit.** If both sides have commits but no textual conflicts, a three-way merge commit is created with message `Merge upstream/<branch> into <branch>`.
3. **Agentic resolution.** On a real conflict, the button flips to show the conflicting files and offers **Let Aion-Micro try**. Aion-Micro (a local SmolLM2-135M container) attempts to resolve each hunk with either deterministic rules (identical, whitespace-only, side-deletion) or an `OURS`/`THEIRS`/`UNCLEAR` pick. Only `high`-confidence resolutions get committed; anything else leaves the conflict markers in the working tree so you can finish the merge in the Editor tab.

The **Open PR to upstream** button next to it opens a pre-filled GitHub compare URL (`Civicognita/<repo>/compare/<branch>...<your-login>:<branch>`) in a new tab — the fastest path to submitting work back upstream.

### API reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/dev/core-forks/status` | Returns `{ forks: CoreForkStatus[], branch }` for all five core forks. Bounded `git fetch upstream` per repo. |
| `POST` | `/api/dev/core-forks/:slug/merge` | Body `{ strategy?: "ff-only" \| "agentic" }`. Returns a `CoreForkMergeResult` — either `{ ok: true, ff, agentic, newSha, pushed }` on success, `{ ok: false, conflict: true, files, ... }` on conflict, or `{ ok: false, conflict: false, reason }` on refusal (dirty tree, unknown slug). |

Both routes require the same private-network + admin-role guard as `/api/dev/status`.
