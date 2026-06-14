# Contributing to Aionima

Aionima is developed through **custodian forks**. You never push to the canonical
upstream repositories directly — all work flows back via cross-repo pull requests.

## The golden rules

1. **Develop on `dev`.** Every fork tracks and works on the `dev` branch.
2. **PRs always target upstream `dev` — never `main`.** Stable releases are promoted
   `dev → main` separately by maintainers. A PR opened against `main` will be redirected.
3. **Never `git push upstream`.** Push to your own fork (`origin`, e.g. `wishborn/<repo>`)
   only. Upstream (`Civicognita/*`, `Particle-Academy/*`) accepts work **only** through
   cross-repo PRs.

## Two kinds of contribution

Aionima distinguishes two contribution streams, surfaced in the dashboard under the
**_aionima → Contribute** tab:

| Stream | Targets | What it carries |
|--------|---------|-----------------|
| **Learnings** | PRIME corpus (`Civicognita/aionima`) | Knowledge, doctrine, and corpus updates — the things Aion *learns*. |
| **Mechanics** | `agi`, the Plugin/MApp Marketplaces, the `@particle-academy/*` UI packages, Local-ID, … | Code, framework, and tooling changes — the things that make Aion *work*. |

Both open the same shape of PR: `‹your-fork›:‹branch› → ‹upstream›:dev`.

## Opening a contribution PR

The dashboard automates this. With **Contributing Mode** enabled
(`Settings → Gateway → Contributing`), open **_aionima → Contribute**. Each core repo your
fork is ahead of `upstream/dev` shows a **Create PR** button. Clicking it:

1. Confirms your fork has commits ahead of `upstream/dev` (refuses a no-op PR).
2. Drafts a PR title + body (AI-drafted via the local floor model, with a commit-list
   fallback when offline).
3. Opens the cross-repo PR to `dev` and returns the PR URL.

If a PR for the same branch is already open, the dashboard links to it instead of
creating a duplicate.

### Doing it by hand

```bash
# from inside your fork clone, on your dev branch
git push origin dev
# then open a PR:  <you>/<repo>:dev  →  Civicognita/<repo>:dev   (or Particle-Academy for PAx)
```

## Per-repo conventions

- **Version bump every commit** that changes a shippable artifact (`package.json` patch).
  The upgrade system compares versions to trigger restarts.
- **Update docs in the same commit as code.** If you change behavior, update the matching
  doc under `docs/`.
- **UI primitives go upstream.** If a primitive is missing from the `@particle-academy/*`
  packages, build it there and PR it — don't hand-roll a local workaround. See
  `docs/agents/contributing-to-adf-packages.md`.

## Where this is enforced

The outbound PR flow lives in `packages/gateway-core/src/dev-mode-contribute.ts`
(status + PR creation) and the **Contribute** panel
(`ui/dashboard/src/components/AionimaContributePanel.tsx`). The inbound side
(pulling upstream into your fork) is `dev-mode-merge.ts` + the upgrade wizard.
