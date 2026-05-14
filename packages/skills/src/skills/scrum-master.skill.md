---
name: scrum-master
description: Summarize channel activity, surface stand-up signals, and report on team engagement over a window
domain: channel
triggers:
  - stand[-\s]?up
  - daily report
  - who was active
  - channel activity
  - team activity
  - weekly summary
  - who shipped this week
  - scrum (?:report|summary|update)
  - summarize (?:the|this|that)? channel
  - last (?:week|7 days|day|24 hours) (?:in|on)
  - engagement report
requires_state: [ONLINE]
priority: 6
direct_invoke: true
---

When the entity asks for a stand-up summary, channel activity, or "who was active in #channel" type query, use the `*_aggregate_stats` bridge tool family to roll up engagement metrics and produce a structured report.

## Process

1. **Identify the channel.** The entity may name a channel ("#general", "the dev channel") or imply one from the project context. Resolve to a concrete `channelId`:
   - If the channel name is explicit, ask the bridge tool family for an `_available_rooms` listing (e.g. `discord_available_rooms`) and match by display name.
   - If a channel is bound to the current project via `project.json rooms[]` (see CHN-D), the gateway already knows which `channelId` to use — prefer that binding over fuzzy name match.
   - If still ambiguous (multiple matches, no project binding), ask the entity which channel to use.

2. **Pick the window.** Default to **last 7 days** unless the entity specifies:
   - "yesterday" / "last 24 hours" → `days=1`
   - "this week" / "last week" → `days=7`
   - "this month" → `days=30`
   - "this quarter" → `days=90` (max)

3. **Call `<channel>_aggregate_stats`** with `{channelId, days, limit?}`. The tool returns:
   ```
   {
     channelId, dayRange,
     messageCount, uniqueAuthors,
     topAuthors: [{authorId, authorName, messageCount}, ...up to 5],
     firstMessageAt, lastMessageAt,
     botMessagesExcluded
   }
   ```
   - For an empty window (`messageCount === 0`), report "No activity in {dayRange}" and stop — don't call other tools.
   - For very small windows (`messageCount < 5`), the top-authors list is more noise than signal — mention the count and skip the leaderboard.

4. **Optionally enrich top authors.** If the entity wants more than a leaderboard (e.g. "what did Alice work on this week?"), follow up with `<channel>_get_user_activity` for the top 1-3 authors. Keep this opt-in — don't auto-enrich every report; it burns API quota.

5. **Optionally pull representative messages.** If the entity asks for highlights or "what shipped", call `<channel>_search_messages` with `{channelId, fromTs, toTs, limit: 20}` using the `firstMessageAt` / `lastMessageAt` from step 3 as bounds.

## Output Format

Always lead with the headline numbers, then the leaderboard, then optional enrichment.

```
## Stand-up — #{channel-name} · {dayRange}

**{messageCount} messages** from **{uniqueAuthors} contributor(s)**
(window: {firstMessageAt} → {lastMessageAt})

### Top contributors
1. {authorName} — {messageCount} messages
2. ...
```

If `botMessagesExcluded > 0`, append a one-line footer:
```
_Bots excluded: {botMessagesExcluded} messages from non-human authors._
```

If the entity asked for enrichment, add a `### What they worked on` section per top author with a 1-2 sentence rollup pulled from `get_user_activity` results.

## Multi-Channel Stand-Ups

If the entity asks for activity across multiple channels (e.g. "stand-up across all our channels"):
1. List bound rooms for the current project via `project.json rooms[]`.
2. Call `<channel>_aggregate_stats` for each — in parallel if the agent runtime supports it.
3. Produce one section per channel, ordered by `messageCount` desc.
4. Add a top-line "**Total: M messages from N contributors across K channels**" line.

## Important Notes

- **Bots are excluded by default** — the aggregator filters out `isBot: true` authors because scrum-master cares about human contribution. The `botMessagesExcluded` count is informational only.
- **Day window is server-clock relative** — `days=7` means "last 7 days from now", not "this calendar week". If the entity needs a specific date range, mention they can pass `fromTs`/`toTs` to `<channel>_search_messages` directly.
- **The 1000-message limit caps very-active channels** — if a channel exceeds this in the window, the report represents only the most recent 1000 messages. Mention this caveat when `messageCount === 1000` (likely truncated).
- **Today only the Discord bridge implements `_aggregate_stats`.** Other channels (Slack, Matrix, web) will gain it as they migrate to `defineChannelV2` (s163, s164, et al.). When asked about a channel that hasn't migrated yet, say so explicitly rather than guessing.
- **Per project, not per server.** Stand-up reports are scoped to the channel the entity asks about; the scrum-master skill does not auto-discover other channels in the Discord server unless they're bound in `project.json rooms[]`.

## Examples

> Entity: "stand-up report for #general last week"

→ Resolve `#general` to channelId → call `discord_aggregate_stats({channelId, days: 7})` → render the headline + leaderboard.

> Entity: "who was active in #dev yesterday and what did they ship?"

→ Resolve `#dev` to channelId → `discord_aggregate_stats({channelId, days: 1})` → for top 2-3 authors call `discord_get_user_activity` → render headline + leaderboard + per-author rollup.

> Entity: "stand-up across all our channels"

→ Read `project.json rooms[]` for current project → for each bound room call `<channel>_aggregate_stats` in parallel → render per-channel sections sorted by messageCount desc + total line.
