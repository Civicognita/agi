# @agi/channel-sdk Changelog

## DEPRECATION NOTICE (v0.4.x — CHN-M s174)

`@agi/channel-sdk@0.1` is deprecated. Channel adapters now implement the
`ChannelDefinition` / `ChannelProtocol` contract from `@agi/sdk` via
`createChannelDefV2()` (see `agi/docs/agents/channel-plugin-redesign.md §11`).

**Migration status (as of 2026-05-15):**

| Adapter | v2 migrated | Notes |
|---------|-------------|-------|
| Slack | ✅ v2-only | `@agi/channel-sdk` dep removed |
| Telegram | ✅ v2 + legacy | Legacy removed after CHN-M |
| WhatsApp | ✅ v2 + legacy | Legacy removed after CHN-M |
| Signal | ✅ v2 + legacy | Legacy removed after CHN-M |
| Discord | 🔲 backlog | |
| Gmail | 🔲 backlog (s171) | Unblocks full deletion |

**Deletion plan:** One release after all adapters migrate. Gmail (s171) is
the blocker. Full deletion in CHN-M (s174).
