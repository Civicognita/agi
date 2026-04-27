# Plan vs PM — when to use each

Aionima agents have two related but distinct durable surfaces: the **plan** tool and the **PM** tool. They look similar (both track work, both have status fields, both persist) but serve different purposes. Confusing them produces redundant writes, stale state, and audit-trail noise.

## TL;DR decision table

| Question | If yes → use plan | If yes → use PM |
|---|---|---|
| Does the work live within a single Aion session? | ✓ | |
| Will multiple iterations / cycles touch this work? | | ✓ |
| Should the owner see this in a project audit trail? | | ✓ |
| Does the work transition through review states (qa, finished)? | | ✓ |
| Is this internal scaffolding for "what to do next in this turn"? | ✓ | |
| Does an autonomous cron-nudged loop need to pick this up? | | ✓ |
| Is this scoped to a chat session or a single feature delivery? | ✓ | |
| Should this survive process restart and be queryable next week? | | ✓ |

## What plan is

**Within-iteration scaffolding.** The plan tool (`packages/gateway-core/src/plan-store.ts`) creates a Markdown-with-frontmatter document at `~/.agi/{projectSlug}/plans/{planId}.mdc`. Each plan has steps with their own status (`pending → running → complete | failed | skipped`) and an overall status (`draft → reviewing → approved → executing → testing → complete | failed`).

**Use plan when:** Aion needs to break a non-trivial request into ordered steps within the current chat session. The plan is Aion's working memory for the turn. It dies (in spirit) when the work ships, even if the file lingers.

**Plan IDs:** `plan_<ulid>` — distinct prefix so they're never confused with PM task IDs.

**Plan storage:** `~/.agi/{projectSlug}/plans/` — file-based, project-scoped.

## What PM is

**Across-iteration tracking.** The PM tool (`packages/aion-sdk/src/pm.ts`) speaks the canonical tynn workflow (`backlog → starting → doing → testing → finished`, with branches to `blocked` and `archived`). Storage is pluggable — TynnPmProvider talks to a tynn MCP server today; tynn-lite (file-based) and plugin-registered alternatives (Linear, Jira, GitHub Projects) land via s118 t433/t434.

**Use PM when:** Aion is participating in a durable workflow that crosses iterations, surfaces in an owner-facing audit trail, or needs to be picked up autonomously by the cron-nudge scheduler. Examples: shipping a feature across multiple cycles, fixing a bug, completing a multi-cycle effort.

**PM task IDs:** Provider-defined (tynn ULIDs like `01kq5ck7mpetp71jtygzw45ets`). Never share a prefix with plan IDs.

**PM storage:** Provider-defined. TynnPmProvider goes through the tynn MCP server (no local file). Other providers ship their own storage shape.

## How they compose

Plan and PM are **complementary, not redundant**. The pattern when both are in play:

1. **PM tracks the durable obligation.** Aion files a tynn task ("Add cron-nudge scheduler"). The owner sees this on the iterative-work page + project audit trail.
2. **Plan tracks the within-iteration tactic.** When Aion picks the task up in a cycle, it may create a plan with steps ("design schema", "write scheduler skeleton", "wire boot path", "write tests"). The plan is private to that cycle's reasoning.
3. **The plan's `tynnRefs.taskIds` array points back to the PM task(s)** the plan is helping execute. This is the only legitimate cross-reference. PM tasks do NOT carry plan IDs back — the dependency is one-directional.
4. **When the cycle ends:** the plan ships (status: `complete`); the PM task transitions (often `doing → testing`). The plan file remains as audit but isn't "live" — its job is done.

## Anti-patterns

- ❌ **Filing the same item in both** as parallel artifacts. If it's worth a tynn task, file it there; the plan should help execute it, not duplicate the obligation.
- ❌ **Long-lived plans that span multiple cycles.** A plan that's still `executing` after several cycles should probably be split — one PM task per durable obligation, fresh plans per cycle.
- ❌ **Plan steps that mirror PM task statuses.** Plan steps are tactical (file paths, commands, verification); PM task statuses are governance (review gates, owner sign-off).
- ❌ **Plan IDs leaking into PM contexts** (or vice versa). The prefix discipline (`plan_*` vs PM provider's native ULIDs) prevents accidental collisions; respect it.

## Reference

- Plan tool: `packages/gateway-core/src/plan-store.ts` + `plan-types.ts`
- PM interface: `packages/aion-sdk/src/pm.ts`
- TynnPmProvider impl: `packages/gateway-core/src/pm/tynn-provider.ts`
- Composition regression test: `packages/gateway-core/src/iterative-work/composition.test.ts`
- Iterative-work discipline: `agi/prompts/iterative-work.md` § "Pairing with PM"
- The bigger picture (what tynn IS and isn't): `agi/docs/agents/tynn-and-related-concepts.md`
