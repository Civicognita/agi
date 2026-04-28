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

## How Dev Mode upgrades work

Dev Mode flips the upgrade path from "pull from Civicognita" to "pull from the owner's fork" via a one-time origin rewrite. Once the rewrite happens, every subsequent `agi upgrade` fetches directly from your fork — no PR round-trip required.

The rewrite is performed by `scripts/upgrade.sh`'s `ensure_origin_remote()` helper, added in v0.4.66. On each upgrade cycle, the helper:

1. Reads `dev.agiRepo`, `dev.primeRepo`, `dev.idRepo` from `~/.agi/gateway.json`.
2. Checks the current origin URL of `/opt/agi`, `/opt/agi-prime`, `/opt/agi-local-id`.
3. If the origin doesn't match the configured fork URL, rewrites it with `git remote set-url`.
4. Emits structured log entries (`origin-agi`, `origin-prime`, `origin-id`) with status `verify` (origin aligned), `info` (repointed), `skip` (dir missing / no config), or `error` (rewrite failed). The dashboard upgrade log surfaces these.

**Expected sequence on first Dev Mode enable:**

1. Toggle Dev Mode in `Settings → Gateway → Contributing` (or your plugin's Dev Mode button).
   - `/api/dev/switch` creates/reuses owner forks on GitHub via the owner's OAuth token.
   - The five `dev.*Repo` fields populate in `gateway.json`.
   - The core-fork workspace clones appear under `~/_projects/_aionima/`.
   - `/opt/*` origins still point at Civicognita — this is expected at this stage.

2. Run `agi upgrade` (or click Upgrade in the dashboard).
   - `ensure_origin_remote` fires for the first time with the newly populated fork URLs.
   - Each `/opt/*` origin is rewritten to `https://github.com/<your-login>/<repo>.git`.
   - The upgrade log shows three `origin-* info` + `origin-* verify` entries.
   - The pull step then fetches from your fork, so the code deployed is your fork's HEAD.

3. Every subsequent `agi upgrade` is just a fast-forward from your fork.
   - `ensure_origin_remote` runs again but sees origin already aligned — emits `verify` only.
   - Push a commit to your fork's dev branch, run `agi upgrade`, it lands on `/opt/agi` without any PR.

**Surface in the dashboard:**

- `GET /api/dev/status` includes `originsAligned: boolean` — true only when every `/opt/*` origin matches its `dev.*Repo`.
- When false, Settings → Gateway → Contributing shows a yellow "Origin rewrite pending — re-run `agi upgrade`" callout with a list of misaligned origins.
- `agi doctor` (CLI) reports the same state under the "Dev Mode" section, with the same remediation hint.

**Surface in `agi doctor`:**

```
▼ Dev Mode
  ✓ AGI origin: https://github.com/wishborn/agi.git
  ✓ PRIME origin: https://github.com/wishborn/aionima.git
  ✓ ID origin: https://github.com/wishborn/agi-local-id.git
  ✓ NPU hardware: /dev/accel/accel0
```

A red or yellow mark on any origin row means `agi upgrade` hasn't completed the migration for that service. Run the upgrade and re-check.

**Flipping Dev Mode OFF:**

Toggle Dev Mode off in the dashboard → `dev.enabled: false` in config → next `agi upgrade` → `ensure_origin_remote` sees that `dev.*Repo` are no longer the effective URLs (because the fallback branches to Civicognita) → rewrites origins back to Civicognita → subsequent upgrades pull canonical releases again.
