# Contributing to ADF Packages (PAx)

**Audience:** Aion + human contributors maintaining the four
Particle-Academy packages that form the ADF UI primitive layer.

This document describes the **maintenance loop**: when AGI (or another
consumer) needs a primitive that doesn't exist yet, when a primitive has
a bug, or when a primitive needs a new variant — how that work gets done
without leaving local fallbacks scattered across the consumer.

---

## 1. The four PAx packages

| Package | npm | What it provides |
|---|---|---|
| `react-fancy` | `@particle-academy/react-fancy` | React component library — Card, Tabs, AccordionPanel, Sidebar, Action, Field, Pillbox, Avatar, Tooltip, Popover, Dropdown, Modal, Editor, ContentRenderer, Canvas, Diagram, etc. |
| `fancy-code` | `@particle-academy/fancy-code` | Code editor / syntax highlighting (CodeMirror-backed). Powers the Editor sub-surface, file previews, terminal/log viewers. |
| `fancy-sheets` | `@particle-academy/fancy-sheets` | Data grid primitive — sortable columns, virtualization, click-to-expand rows, multi-select. Powers the Projects browser list view, dependency tables, tynn task lists. |
| `fancy-echarts` | `@particle-academy/fancy-echarts` | Charts on Apache ECharts — sparklines, Sankey, timeline, donut. Renamed from `react-echarts` upstream; npm rename pending (first work item). |

All four live in this workspace as siblings to `agi/`:

| Symlink | Repo | Push origin | Upstream |
|---|---|---|---|
| `~/temp_core/react-fancy` | `/home/wishborn/_projects/_aionima/react-fancy` | `wishborn/react-fancy` | `Particle-Academy/react-fancy` |
| `~/temp_core/fancy-code` | `/home/wishborn/_projects/_aionima/fancy-code` | `wishborn/fancy-code` | `Particle-Academy/fancy-code` |
| `~/temp_core/fancy-sheets` | `/home/wishborn/_projects/_aionima/fancy-sheets` | `wishborn/fancy-sheets` | `Particle-Academy/fancy-sheets` |
| `~/temp_core/fancy-echarts` | `/home/wishborn/_projects/_aionima/fancy-echarts` | `wishborn/fancy-echarts` | `Particle-Academy/fancy-echarts` |

Provisioned via the **Contributing Mode** toggle in
`Settings → Gateway → Contributing` (single source of truth:
`packages/gateway-core/src/dev-mode-forks.ts CORE_REPOS`). Never
`gh repo fork` manually — extend `CORE_REPOS` if a needed repo isn't
there.

---

## 2. Tynn surface — where the work lives

The **PAx domain** (slug: `pax`) holds maintenance work, with one
**feature** per package:

- `react-fancy`
- `fancy-code`
- `fancy-sheets`
- `fancy-echarts`

When AGI needs a primitive that doesn't exist (or a bug fix to one that
does), file a **tynn story** under the relevant feature. The umbrella
domain pattern beats per-package projects because the four packages
evolve together — a Tabs change in `react-fancy` often pairs with a
syntax-highlighting tweak in `fancy-code`.

---

## 3. The maintenance loop

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. AGI hits a primitive gap (or bug)                                │
│      e.g. "MCPTab needs Tabs.WithBadge variant"                      │
│                                                                       │
│ 2. File a tynn story under PAx                                       │
│      • Domain: pax                                                   │
│      • Feature: react-fancy (or fancy-* per the package)             │
│      • Title states the primitive need or bug clearly                │
│                                                                       │
│ 3. File a GitHub issue in Particle-Academy/<repo>                    │
│      gh issue create -R Particle-Academy/<repo> ...                  │
│                                                                       │
│ 4. Branch in the wishborn fork (origin)                              │
│      cd ~/temp_core/<repo>                                           │
│      git checkout dev                                                │
│      git pull upstream main          # rebase onto upstream          │
│      git checkout -b <topic-branch>                                  │
│                                                                       │
│ 5. Implement + test in the package                                   │
│      • Add the primitive / fix the bug                               │
│      • Add tests (per-package conventions)                           │
│      • Bump version in package.json (semver minor for new            │
│        primitives, patch for bug fixes)                              │
│                                                                       │
│ 6. Commit + push to wishborn dev branch                              │
│      • Three same-commit guards: typecheck, lint, tests              │
│      • git push origin <topic-branch>                                │
│      • NEVER push to Particle-Academy upstream directly              │
│                                                                       │
│ 7. Open a PR upstream (cross-repo PR)                                │
│      gh pr create --repo Particle-Academy/<repo> \                   │
│        --base main --head wishborn:<topic-branch>                    │
│                                                                       │
│ 8. Merge upstream → npm publishes on tag                             │
│      • Particle-Academy maintainer (you) reviews + merges            │
│      • Tag the merge commit on Particle-Academy/main with the new    │
│        version → trusted publisher GitHub Action publishes to npm    │
│                                                                       │
│ 9. Bump the consumer (AGI dashboard or whoever consumes it)          │
│      cd ~/temp_core/agi/ui/dashboard                                 │
│      Edit package.json → "@particle-academy/<repo>": "^X.Y.Z"        │
│      pnpm install --filter @agi/dashboard                            │
│      Commit + push to wishborn/agi:dev                               │
│                                                                       │
│ 10. Ship via agi upgrade                                              │
│      • Same-commit guards                                            │
│      • Version bump in agi/package.json                              │
│      • agi upgrade                                                   │
│      • Verify in browser (Playwright preferred)                      │
│                                                                       │
│ 11. Walk the tynn story to done                                       │
│      • mcp__tynn__starting → testing → finished                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. When NOT to file upstream

If the primitive need is genuinely AGI-specific (e.g., wraps a tynn
concept that wouldn't make sense in a general-purpose component
library), build it locally in `agi/ui/dashboard/src/components/ui/*`
instead. Examples already in tree:
- `dev-notes.tsx` (cycle 87) — a page-level dev-notes primitive that
  ADF-candidates but stayed local while the API stabilized.
- `panel-trigger.tsx`
- `stack-picker.tsx`

The deciding question: **would a different consumer of `react-fancy`
(plugin, MApp, locally-hosted app) want this primitive?** If yes →
upstream. If no → local. If unsure → start local, lift upstream when
a second consumer wants it.

---

## 5. Conventions (must follow)

- **Push origin only.** `git push origin <branch>` to wishborn fork.
  Never `git push upstream` to Particle-Academy. Cross-repo PR only.
- **Dev branch development.** Work on `dev` (or topic branches off
  dev). Never push to `main` on wishborn fork either — `main` is for
  upstream-merge syncs only.
- **Three same-commit guards** (mirror AGI conventions):
  typecheck, lint, tests. Each package has its own scripts; check
  `package.json`.
- **Version bumps in the same commit as the change.** Semver minor
  for new primitives, patch for bug fixes, major for breaking.
- **No silent local workarounds.** If you hit a bug AND can't fix
  upstream immediately, file the upstream issue first, then make a
  local workaround that imports from the published package and wraps.
  The workaround references the upstream issue in a comment so the
  cleanup path is discoverable later.

---

## 6. npm publish workflow

Particle-Academy uses **npm trusted publishers** (per the npm.com tab
the owner had open during cycle 88 setup). This means:

- **Don't run `npm publish` manually** on a PAx package. Trusted
  publishing happens via a GitHub Action triggered by a tag on the
  upstream `main` branch.
- The action validates the tag matches package.json's version, then
  publishes. No npm token sits on any developer machine.
- To publish: merge the PR upstream, tag the merge commit
  (`v<X.Y.Z>`), push the tag. Action does the rest.

If a publish fails: check the GitHub Actions log on the upstream repo,
not anywhere local.

---

## 7. Quick reference — common operations

### File a tynn story for a missing primitive

```
mcp__tynn__create({
  a: "story",
  title: "Tabs.WithBadge variant — count chip on tab labels",
  because: "MCPTab needs to surface 'open issues per tab' counts...",
  on: { feature_id: "<react-fancy feature ULID>" }
})
```

### Open a cross-repo PR

```bash
cd ~/temp_core/react-fancy
git checkout -b feat/tabs-with-badge
# implement + tests + version bump
git commit -am "Tabs.WithBadge variant + tests"
git push origin feat/tabs-with-badge
gh pr create --repo Particle-Academy/react-fancy \
  --base main --head wishborn:feat/tabs-with-badge \
  --title "Tabs.WithBadge variant" \
  --body "$(cat <<'EOF'
Adds Tabs.WithBadge for surfacing counts on tab labels.

## Summary
- New Tabs.WithBadge variant: count chip on the tab label
- Storybook story + tests
- No breaking changes

## Test plan
- [x] Unit tests pass
- [x] Storybook renders the variant
- [x] Visual regression snapshots updated
EOF
)"
```

### Bump consumer to a new PAx version

```bash
cd ~/temp_core/agi/ui/dashboard
# Edit package.json → bump the @particle-academy/<repo> version
pnpm install --filter @agi/dashboard
# Verify imports still typecheck:
cd ~/temp_core/agi && pnpm typecheck
# Bump agi version + commit + push + agi upgrade
```

### List currently installed PAx versions

```bash
cd ~/temp_core/agi/ui/dashboard
grep -E "@particle-academy/" package.json
```

---

## 8. References

- `CLAUDE.md § 1.5` — ADF anchor, particle-academy bug routing
- `agi/docs/human/adf.md` — ADF framework reference
- `packages/gateway-core/src/dev-mode-forks.ts CORE_REPOS` — provisioning
  registry (s136 t512 cycle 88)
- `agi/docs/human/dev-mode.md` — Contributing Mode toggle docs

---

**Status:** s136 t520 (cycle 89). The first concrete work item this
loop will execute end-to-end is the npm rename
`@particle-academy/react-echarts → @particle-academy/fancy-echarts`
(GitHub repo rename is upstream-complete; only the npm package rename
remains).
