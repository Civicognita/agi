# Contributing Mode

Contributing Mode (formerly Dev Mode) lets you switch Aionima between production repositories (Civicognita / Particle-Academy) and personal fork directories for development work.

## Core Repos

Contributing Mode provisions **thirteen repositories** across two upstream organizations:

### Civicognita core (5 repos)

| Repo | Upstream | Fork (default) |
|------|----------|----------------|
| AGI | `Civicognita/agi` | `wishborn/agi` |
| PRIME | `Civicognita/aionima` | `wishborn/aionima` |
| Hive-ID | `Civicognita/agi-hive-id` | `wishborn/agi-hive-id` |
| Plugin Marketplace | `Civicognita/agi-marketplace` | `wishborn/agi-marketplace` |
| MApp Marketplace | `Civicognita/agi-mapp-marketplace` | `wishborn/agi-mapp-marketplace` |

### Particle-Academy UI packages / PAx (8 repos)

| Repo | Upstream | Fork (default) |
|------|----------|----------------|
| react-fancy | `Particle-Academy/react-fancy` | `wishborn/react-fancy` |
| fancy-code | `Particle-Academy/fancy-code` | `wishborn/fancy-code` |
| fancy-sheets | `Particle-Academy/fancy-sheets` | `wishborn/fancy-sheets` |
| fancy-echarts | `Particle-Academy/fancy-echarts` | `wishborn/fancy-echarts` |
| fancy-3d | `Particle-Academy/fancy-3d` | `wishborn/fancy-3d` |
| fancy-screens | `Particle-Academy/fancy-screens` | `wishborn/fancy-screens` |
| fancy-whiteboard | `Particle-Academy/fancy-whiteboard` | `wishborn/fancy-whiteboard` |
| agent-integrations | `Particle-Academy/agent-integrations` | `wishborn/agent-integrations` |

All thirteen forks clone to `~/_projects/_aionima/repos/<name>/`. The single source of truth for this list is `packages/gateway-core/src/dev-mode-forks.ts:CORE_REPOS`.

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

When Contributing mode is on, the Projects page shows two **Sacred Projects** portal cards at the top:

- **Civicognita Sacred Projects** — AGI, PRIME, Hive-ID, Plugin Marketplace, MApp Marketplace.
- **PAx Sacred Projects** — react-fancy, fancy-code, fancy-sheets, fancy-echarts, fancy-3d, fancy-screens, fancy-whiteboard, agent-integrations.

All Sacred Project cards use a gold star + indigo card style and are immutable (no rename/delete). If a repo is missing, the card shows **Not provisioned** until it’s created.

Note: Local-ID (`aionima-local-id`) was removed from the core-repo list when its functionality was absorbed into `gateway-core` (s180). It no longer appears in Contributing Mode.

### Repo Status Cards

Cards show the current state of each repo:
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

Once Dev Mode has provisioned all thirteen owner forks under `~/_projects/_aionima/repos/`, each one shows up in the dashboard Projects list with a restricted UX: only an **Editor** and a **Repository** tab. The Repository tab is specialised for core forks.

The tab surfaces three numbers: the branch the gateway is subscribed to (from `gateway.updateChannel`), the fork's HEAD SHA, and the upstream (Civicognita) HEAD SHA. Two badges — `↑ N ahead`, `↓ N behind` — summarise divergence vs `upstream/<branch>`.

When upstream has moved ahead of your fork, the **Merge upstream → origin** button lights up. Clicking it walks three escalation steps automatically:

1. **Fast-forward.** If your fork is purely behind (no local commits), the merge is a straight `git merge --ff-only`. The result pushes to `origin` so the next `agi upgrade` picks it up.
2. **Merge commit.** If both sides have commits but no textual conflicts, a three-way merge commit is created with message `Merge upstream/<branch> into <branch>`.
3. **Agentic resolution.** On a real conflict, the button flips to show the conflicting files and offers **Let Aion-Micro try**. Aion-Micro (a local SmolLM2-135M container) attempts to resolve each hunk with either deterministic rules (identical, whitespace-only, side-deletion) or an `OURS`/`THEIRS`/`UNCLEAR` pick. Only `high`-confidence resolutions get committed; anything else leaves the conflict markers in the working tree so you can finish the merge in the Editor tab.

The **Open PR to upstream** button next to it opens a pre-filled GitHub compare URL (`Civicognita/<repo>/compare/<branch>...<your-login>:<branch>`) in a new tab — the fastest path to submitting work back upstream.

### API reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/dev/core-forks/status` | Returns `{ forks: CoreForkStatus[], branch }` for all thirteen forks (five Civicognita core + eight PAx). Bounded `git fetch upstream` per repo. |
| `POST` | `/api/dev/core-forks/:slug/merge` | Body `{ strategy?: "ff-only" \| "agentic" }`. Returns a `CoreForkMergeResult` — either `{ ok: true, ff, agentic, newSha, pushed }` on success, `{ ok: false, conflict: true, files, ... }` on conflict, or `{ ok: false, conflict: false, reason }` on refusal (dirty tree, unknown slug). |

Both routes require the same private-network + admin-role guard as `/api/dev/status`.

## Contributing to Particle-Academy (PAx) packages

The eight PAx packages (`react-fancy`, `fancy-code`, `fancy-sheets`, `fancy-echarts`, `fancy-3d`, `fancy-screens`, `fancy-whiteboard`, `agent-integrations`) are ADF UI primitives maintained under the `Particle-Academy` GitHub org. Contributing Mode provisions personal forks at `wishborn/<repo>` and clones them into `~/_projects/_aionima/repos/<name>/`, identical to how the Civicognita core repos are handled.

### Development workflow

1. **Sync first.** Before starting any PAx work, pull the latest upstream dev branch to avoid immediately-stale feature branches:
   ```bash
   git fetch origin && git pull origin dev
   ```
2. **Create a feature branch:**
   ```bash
   git checkout -b <feature-name>
   ```
3. **Build and test** the component inside the PAx repo.
4. **Commit and push** to your fork (`wishborn/<repo>`):
   ```bash
   git push origin <feature-name>
   ```
5. **Open a cross-repo PR:** `wishborn/<repo>:<feature-name> → Particle-Academy/<repo>:main`.

### Important constraints

- **Never `git push upstream`** — `upstream` points at `Particle-Academy/<repo>` and is read-only. All pushes go to `origin` (`wishborn/<repo>`).
- The AGI side consumes a new PAx primitive only **after** the PR merges and a new package version is published. Pre-merge, leave a hand-rolled placeholder in AGI with a comment pointing at the open PR.
- If you hit a bug in a PAx package, file an issue in the corresponding `Particle-Academy/<repo>` repository. Do not work around it locally with a permanent hand-rolled fallback.

## How Dev Mode upgrades work

Dev Mode flips the upgrade path from "pull from Civicognita" to "pull from the owner's fork" via a one-time origin rewrite. Once the rewrite happens, every subsequent `agi upgrade` fetches directly from your fork — no PR round-trip required.

The rewrite is performed by `scripts/upgrade.sh`'s `ensure_origin_remote()` helper, added in v0.4.66. On each upgrade cycle, the helper:

1. Reads `dev.agiRepo`, `dev.primeRepo` from `~/.agi/gateway.json`.
2. Checks the current origin URL of `/opt/agi`, `/opt/agi-prime`.
3. If the origin doesn't match the configured fork URL, rewrites it with `git remote set-url`.
4. Emits structured log entries (`origin-agi`, `origin-prime`) with status `verify` (origin aligned), `info` (repointed), `skip` (dir missing / no config), or `error` (rewrite failed). The dashboard upgrade log surfaces these.

**Expected sequence on first Dev Mode enable:**

1. Toggle Dev Mode in `Settings → Gateway → Contributing` (or your plugin's Dev Mode button).
   - `/api/dev/switch` creates/reuses owner forks on GitHub via the owner's OAuth token.
   - The `dev.*Repo` fields populate in `gateway.json`.
   - The core-fork workspace clones appear under `~/_projects/_aionima/`.
   - `/opt/*` origins still point at Civicognita — this is expected at this stage.

2. Run `agi upgrade` (or click Upgrade in the dashboard).
   - `ensure_origin_remote` fires for the first time with the newly populated fork URLs.
   - Each `/opt/*` origin is rewritten to `https://github.com/<your-login>/<repo>.git`.
   - The upgrade log shows `origin-* info` + `origin-* verify` entries.
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
  ✓ NPU hardware: /dev/accel/accel0
```

A red or yellow mark on any origin row means `agi upgrade` hasn't completed the migration for that service. Run the upgrade and re-check.

**Flipping Dev Mode OFF:**

Toggle Dev Mode off in the dashboard → `dev.enabled: false` in config → next `agi upgrade` → `ensure_origin_remote` sees that `dev.*Repo` are no longer the effective URLs (because the fallback branches to Civicognita) → rewrites origins back to Civicognita → subsequent upgrades pull canonical releases again.

### Upgrade Wizard source listing — Upstream vs your fork

The Upgrade Wizard (`GET /api/system/fork-status`) lists every candidate source under
two headings: **Upstream** (the canonical `Civicognita/agi` remote) and **Your fork**
(your personal `wishborn/agi`, shown only in Dev Mode). Each source reports `commitsAhead`
/ `commitsBehind` and a `mergeType` for information — but the **Review →** action is gated
on a separate `isUpgrade` flag, **not** on commit topology.

`isUpgrade` is **version-aware**: a source is a real upgrade only when its `package.json`
version is *strictly newer* than the deployed version. This matters because content flows
`fork/dev → upstream/dev → upstream/main`, so for the First Custodian **`upstream/main`
always trails your fork by the merge commits that carried your own PRs**. Those merge
bubbles make `commitsBehind > 0` (a "three-way" merge) even though the source is an *older*
release. Without the version gate the wizard would offer a phantom "4 commits available"
upgrade back to an older version (the v0.4.906-vs-v0.4.911 case). Sources that are newer by
topology but older by version render as a non-interactive **info row** ("older than your
vX — nothing to pull"), alongside the up-to-date and behind info rows. Only a
strictly-newer source gets a selectable card and a Review button.

---

## Contributing upstream (outbound PRs)

Dev Mode is bidirectional. The **inbound** path pulls upstream into your fork (the upgrade
wizard + `dev-mode-merge.ts`). The **outbound** path contributes your work back as cross-repo
pull requests — surfaced on the **_aionima → Contribute** tab.

Contributions are grouped into two streams:

| Stream | Targets | Carries |
|--------|---------|---------|
| **Learnings** | PRIME (`Civicognita/aionima`) | Knowledge & corpus updates |
| **Mechanics** | `agi`, the Plugin/MApp Marketplaces, the `@particle-academy/*` packages, Local-ID | Code & framework changes |

Each core fork that is ahead of `upstream/dev` shows a **Create PR** button. It:

1. Refuses a no-op PR (must have commits ahead of `upstream/dev`).
2. Drafts a title + body — AI-drafted via the local floor model (aion-micro), with a
   commit-list fallback when offline.
3. Opens `‹your-fork›:‹branch› → ‹upstreamOrg›:dev` and returns the PR URL. An already-open
   PR is linked instead of duplicated.

**PRs always target `dev`, never `main`.** See `CONTRIBUTING.md` for the full convention.
Backend: `packages/gateway-core/src/dev-mode-contribute.ts`;
endpoints `GET /api/dev/contribute/status` + `POST /api/dev/contribute/:slug/pr`.

---

## Reviewing incoming PRs (as Upstream custodian)

The **First Custodian** of Upstream (the owner of `Civicognita/agi`) is the only one who
merges PRs to `dev`/`main`. Other contributors PR their **personal forks** — possibly
forks-of-forks — into the upstream `dev` branch. The dashboard surfaces those open PRs as a
**review queue** so the custodian can inspect and test each one before merging.

`GET /api/dev/incoming/status` returns, per core repo, the open PRs targeting
`‹upstreamOrg›/‹repo›:dev` (`state=open`, sorted by most-recently-updated). Each entry
carries the PR number, title, author, **head repo full name** (the contributor's fork — a
cross-fork PR is flagged via `isCrossRepo`), head ref/sha, draft flag, and timestamps.
Requires a connected GitHub account (the upstream repos may be private; the GitHub list
endpoint is rate-limited unauthenticated) — without a token the endpoint returns an empty
queue with an actionable error.

Backend: `packages/gateway-core/src/dev-mode-incoming.ts`. **Merging stays on GitHub** — an
irreversible write the dashboard never automates.

### Testing a PR live before merge

The **Test in VM** button on a PR row (and the `agi test-vm pr <slug> <number>` CLI) tests the
PR's actual code in the test VM:

```bash
agi test-vm pr agi 178
```

This fetches `pull/178/head` into a **throwaway git worktree** (a sibling under
`_aionima/repos/` — your working tree is never touched), `pnpm install`s it (cheap — pnpm
hard-links from the store), remounts the VM's `/mnt/agi` to the worktree, rebuilds + restarts,
and serves the PR build at `https://test.ai.on`. Click through it; press Enter when done and
your dev tree is **restored automatically** (a trap guarantees the remount + worktree cleanup
even on Ctrl-C). Supported for the `agi` repo only — the VM serves agi, so an agi PR is what can
run live; PRs to PRIME / the marketplaces / PAx are reviewed on GitHub.

The dashboard button is a thin front for this: the live mount-swap waits for you to finish
reviewing and must restore the mount even on interrupt — a terminal trap the headless gateway
can't own — so the button validates the PR and hands you the exact command to run rather than
spawning a job that could leave the VM mounted to a PR. Endpoint:
`POST /api/dev/incoming/:slug/pr/:number/test`. CLI flow:
`scripts/test-vm.sh pr` → `cmd_pr_test`.
