# Channel Plugin Redesign — Design Doc

**Status:** Draft for owner sign-off.
**Owner directive:** 2026-05-13 — "a lot has changed since we first designed the channel plugins, it will need to be updated."
**Scope:** Replace the current `@agi/channel-sdk` shape with a redesigned contract that treats each channel as a **full application** (Intelligence Protocol + management UI + room model + project-binding + project-page surface), not just an event adapter.

This document is the spec the implementation tiers will build against. Nothing in here is shipped yet. Approve / amend / reject section-by-section.

---

## 1. Context — what changed since the originals

The current channel adapters (`channels/discord`, `channels/telegram`, `channels/signal`, `channels/whatsapp`, `channels/gmail`) predate every one of these system shifts:

| Subsystem | When formalized | Affects channels how |
|-----------|-----------------|---------------------|
| **ADF — Agent Development Framework** | 2026-04 onward | Channels are sensory inputs to the agent; should look like Intelligence Protocols (MPx is the first), not standalone plugins |
| **agent-integrations + MicroMcpServer** | 2026-04-30 onward (s142, s157 PAx onboarding) | The bridge-per-session + tool-host pattern is now canonical for "agent-driven UI surfaces." Channel sessions fit this shape exactly |
| **MApps** | s127, s152, s157 + Magic Apps editor | Channels need to be MApp-composable so authors can wire workflows to channel events |
| **Provider abstraction** | s111 cycle 142 onward | Hot-swappable, multi-instance, settings-card pattern Channels should mirror |
| **Project cage** | s130 t515 cycle 71 onward | Chat tools cage to project context; channel-bound events must participate |
| **Pending entities + COA<>COI** | aionima-id matured, Hive-ID still pending | Channel-side users get tentative entity IDs that owner promotes |
| **Iterative-work loops + tynn workflow** | s118 + iterative-work.md | Channel events can fire iterative-work cycles bound to channel-resident projects |
| **PRIME Intelligence Protocols** | mycelium.md formalized | Channels should plug into the same protocol class MPx defines |

The redesign reconciles channels with all eight.

---

## 2. The Channel-as-Application thesis

A channel adapter, redesigned, is **a self-contained application** that owns five surfaces:

1. **Protocol surface** — implements `IntelligenceProtocol`. Inbound message events flow with COA<>COI tagging; outbound replies route the same way.
2. **Bridge surface** — a `MicroMcpServer`-style host that exposes the channel's primitives (`post`, `search_messages`, `get_user`, `list_rooms`, …) as MCP tools other code (agent, MApp, plugin) can call.
3. **Management UI surface** — its own React surface mounted at `/settings/channels/<id>`. The channel plugin ships its config form, server/workspace picker, role inspector, intent toggles, hot-reload buttons. Not gateway-owned.
4. **Project-page UI surface** — a React component the plugin exports, slotted into `ProjectDetail.tsx` when the project has at least one room bound to this channel. Renders the channel's view of that room (threads, messages, composer).
5. **Room abstraction** — exposes a unified `listRooms` / `getRoom` / `subscribeRoom` / `postToRoom` interface that hides the channel's native primitives (Discord forums, Slack channels, Telegram chats, Email mailboxes) behind one contract.

Everything else in the system composes against these five surfaces. The gateway no longer special-cases "discord" or "telegram" — it just iterates registered channels.

---

## 3. The `defineChannel` contract

Public SDK in `@agi/aion-sdk`:

```ts
import type { ReactElement, ComponentType } from "react";

/** A room inside a channel. Maps to Discord forum/channel/DM, Slack channel,
 *  Telegram chat/group/channel, Email mailbox/label, etc. Channel-specific
 *  encoding lives in `roomId` (free-form string); the plugin parses it. */
export interface ChannelRoom {
  /** Channel-scoped unique id (e.g. "1234567890:forum:42" for Discord). */
  roomId: string;
  /** Human-readable label (e.g. "#general", "Bug Reports forum"). */
  label: string;
  /** What kind of room this is (channel-specific vocabulary). */
  kind: "channel" | "forum" | "thread" | "dm" | "group" | "mailbox" | "label" | string;
  /** Parent room id when this is a thread inside a forum, etc. */
  parentRoomId?: string;
  /** Whether messages here are visible to non-members. */
  privacy: "public" | "private" | "secret";
  /** Channel-specific metadata (member count, topic, archived state, ...). */
  meta?: Record<string, unknown>;
}

/** A user as seen by the channel. Resolves to an Aionima entity via the
 *  entity-binding layer (which may map to a `pending-from-<channel>` entity
 *  until owner promotes). */
export interface ChannelUser {
  /** Channel-scoped user id. */
  userId: string;
  /** Display name as the channel knows it. */
  displayName: string;
  /** Username / handle if distinct from displayName. */
  username?: string;
  /** Avatar URL. */
  avatarUrl?: string;
  /** Channel-specific role memberships (Discord role ids, Slack workspace
   *  role, Telegram admin status, ...). */
  roles?: string[];
  /** Online / offline / away / etc when the channel exposes presence. */
  presence?: "online" | "away" | "offline" | "do-not-disturb" | string;
  /** Channel-specific activity (game, status text, ...). */
  activity?: string;
}

export interface ChannelMessage {
  messageId: string;
  roomId: string;
  authorId: string;          // channel-scoped — maps to entity via binding layer
  text: string;
  attachments?: Array<{ kind: "image" | "audio" | "video" | "file"; url: string; mime?: string }>;
  replyToMessageId?: string;
  threadRootMessageId?: string;
  sentAt: string;            // ISO timestamp
  editedAt?: string;
  mentionsBot: boolean;      // did the message @-mention this channel's bot
}

/** Event the channel emits inbound to the gateway. Plugin can subscribe via
 *  the protocol surface; the event-bus dispatcher routes to workflow or
 *  agent based on role/channel bindings. */
export type ChannelEvent =
  | { kind: "message"; message: ChannelMessage }
  | { kind: "message-edit"; message: ChannelMessage }
  | { kind: "message-delete"; messageId: string; roomId: string }
  | { kind: "user-join"; userId: string; roomId: string }
  | { kind: "user-leave"; userId: string; roomId: string }
  | { kind: "presence-change"; userId: string; presence: ChannelUser["presence"]; activity?: string }
  | { kind: "reaction-add"; messageId: string; userId: string; emoji: string }
  | { kind: "reaction-remove"; messageId: string; userId: string; emoji: string }
  | { kind: "ready"; identity: { botId: string; botName: string } }
  | { kind: "error"; error: string };

/** The protocol surface — what every channel implements. */
export interface ChannelProtocol {
  /** Initialize + connect. Returns a teardown handle. */
  start(): Promise<{ stop: () => Promise<void> }>;
  /** Subscribe to inbound events. */
  onEvent(handler: (event: ChannelEvent) => void): () => void;
  /** List all rooms this channel can see. */
  listRooms(): Promise<ChannelRoom[]>;
  /** Get one room by id. */
  getRoom(roomId: string): Promise<ChannelRoom | null>;
  /** Subscribe to events for a specific room (filter at the source). */
  subscribeRoom(roomId: string, handler: (event: ChannelEvent) => void): () => void;
  /** Post a message to a room. */
  postToRoom(roomId: string, message: { text: string; replyToMessageId?: string; attachments?: ChannelMessage["attachments"] }): Promise<ChannelMessage>;
  /** Read message history for a room (paged). */
  searchMessages(roomId: string, opts: { fromTs?: string; toTs?: string; limit?: number; cursor?: string }): Promise<{ messages: ChannelMessage[]; nextCursor?: string }>;
  /** Get one user. */
  getUser(userId: string): Promise<ChannelUser | null>;
  /** List members of a room (or workspace/guild). */
  listMembers(scope: { roomId?: string; guildId?: string }): Promise<ChannelUser[]>;
}

/** The full Channel plugin shape. */
export interface ChannelDefinition {
  /** Stable identifier (e.g. "discord", "telegram"). */
  id: string;
  /** Display name. */
  displayName: string;
  /** Vendor logo URL or icon name. */
  icon?: string;

  /** Build the protocol implementation. Called once per gateway boot with
   *  the channel's config + a bridge host the plugin registers tools on. */
  createProtocol: (ctx: ChannelContext) => ChannelProtocol;

  /** React component for the channel's settings page. Mounted at
   *  /settings/channels/<id>. The plugin owns its own UX completely. */
  SettingsPage: ComponentType<ChannelSettingsPageProps>;

  /** React component slotted into ProjectDetail.tsx when the project has
   *  at least one room bound to this channel. Renders the channel's view
   *  of the bound room(s). */
  ProjectPagePanel?: ComponentType<ChannelProjectPanelProps>;

  /** Bridge tools — registered against the per-session MicroMcpServer so
   *  agents/MApps can call channel primitives. Auto-namespaced with
   *  channel id (e.g. `discord_post_message`, `telegram_search_messages`). */
  bridgeTools: ChannelBridgeToolDefinition[];

  /** Privileged-intents / read-policy declaration. Surfaced in the
   *  Settings UI; owner toggles per-room or per-guild. */
  readPolicy: {
    /** Can read messages the bot is not @-mentioned in? */
    canReadAllMessages: { configurable: boolean; defaultOn: boolean };
    /** Can read user presence (online/offline/activity)? */
    canReadPresence: { configurable: boolean; defaultOn: boolean };
    /** Can read role memberships? */
    canReadRoles: { configurable: boolean; defaultOn: boolean };
    /** Vendor-specific intents the plugin needs (Discord intents, Slack scopes). */
    nativeIntents?: string[];
  };
}

/** Context handed to createProtocol — gateway primitives + plugin config. */
export interface ChannelContext {
  config: Record<string, unknown>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  /** Cage provider — channel events that resolve to a bound project get
   *  caged to that project's tool surface. */
  cageProvider: (roomId: string) => import("./agent-cage").Cage | null;
  /** Entity resolver — map channel userId → Aionima entity (may return
   *  pending-from-<channel> entity until owner promotes). */
  resolveEntity: (userId: string) => Promise<{ entityId: string; isPending: boolean }>;
}
```

The `defineChannel` builder:

```ts
import { defineChannel } from "@agi/aion-sdk";

export default defineChannel({
  id: "discord",
  displayName: "Discord",
  createProtocol: (ctx) => new DiscordProtocol(ctx),
  SettingsPage: DiscordSettingsPage,
  ProjectPagePanel: DiscordProjectPanel,
  bridgeTools: [discordPostMessage, discordSearchMessages, discordGetUser, discordListMembers, discordAggregateStats],
  readPolicy: {
    canReadAllMessages: { configurable: true, defaultOn: false },
    canReadPresence: { configurable: true, defaultOn: false },
    canReadRoles: { configurable: true, defaultOn: true },
    nativeIntents: ["Guilds", "GuildMessages", "MessageContent", "GuildMembers", "GuildPresences", "DirectMessages"],
  },
});
```

---

## 4. Room abstraction — per-channel mapping

How each of the existing 5 channels maps its native vocabulary to `ChannelRoom`:

| Channel | Native concept | `kind` | `roomId` encoding | Notable `meta` |
|---------|---------------|--------|-------------------|---------------|
| **Discord** | Forum channel | `forum` | `<guildId>:forum:<channelId>` | `archivedCount`, `appliedTags` |
| **Discord** | Forum thread | `thread` | `<guildId>:forum:<channelId>:thread:<threadId>` | `parentRoomId` = forum, `appliedTags`, `archived` |
| **Discord** | Text channel | `channel` | `<guildId>:channel:<channelId>` | `topic`, `slowmode` |
| **Discord** | DM | `dm` | `dm:<userId>` | n/a |
| **Slack** | Channel | `channel` | `<teamId>:channel:<channelId>` | `topic`, `purpose`, `isPrivate` |
| **Slack** | DM | `dm` | `<teamId>:dm:<userId>` | n/a |
| **Slack** | Group DM | `group` | `<teamId>:mpdm:<conversationId>` | `members` |
| **Telegram** | Private chat | `dm` | `private:<chatId>` | n/a |
| **Telegram** | Group | `group` | `group:<chatId>` | `memberCount`, `inviteLink` |
| **Telegram** | Supergroup | `group` | `supergroup:<chatId>` | `memberCount`, topic for forum-style |
| **Telegram** | Channel (broadcast) | `channel` | `channel:<chatId>` | `subscriberCount` |
| **WhatsApp** | 1:1 chat | `dm` | `dm:<contactPhoneE164>` | n/a |
| **WhatsApp** | Group | `group` | `group:<groupJid>` | `groupSubject`, `participants` |
| **Email (Gmail)** | Mailbox / label | `label` | `gmail:<labelName>` | `messageCount`, `unreadCount` |
| **Email (Gmail)** | Thread | `thread` | `gmail:thread:<threadId>` | `parentRoomId` = label, `subjectLine` |
| **Signal** | 1:1 | `dm` | `dm:<accountUuid>` | n/a |
| **Signal** | Group | `group` | `group:<groupV2Id>` | `memberCount`, `groupName` |

This is the unified contract callers see. Plugin internals translate.

---

## 5. Project ↔ Room binding

### Data model

Each project's `project.json` gains a `rooms[]` array:

```jsonc
{
  "name": "blackorchid-web",
  "type": "web",
  // ... existing fields ...
  "rooms": [
    { "channelId": "discord", "roomId": "1234567890:forum:42",       "label": "Bug Reports" },
    { "channelId": "discord", "roomId": "1234567890:channel:99",     "label": "#deploys" },
    { "channelId": "slack",   "roomId": "T0A1/channel:C0B2",         "label": "#blackorchid-team" },
    { "channelId": "gmail",   "roomId": "gmail:project/blackorchid", "label": "blackorchid@civicognita" }
  ]
}
```

- **Multi-binding** is the default. A project can have a Discord forum + Slack channel + Email label simultaneously.
- **`label`** is the user's friendly name for this binding, possibly different from the channel's native room label.
- **Channel plugins ARE NOT consulted** to validate the binding at config-write time — gateway resolves room existence lazily via `protocol.getRoom()` on first read. A stale binding (room deleted, plugin offline) renders an "unreachable" state in the UI.

### Resolution flow

1. **Event arrives** → channel protocol emits `ChannelEvent` with `roomId`.
2. **Gateway dispatcher** queries `findProjectByRoom(channelId, roomId)` (indexed lookup against the union of all `project.json.rooms[]`).
3. If matched: event runs in that project's context — cage applies, project-scoped tools available, COA chain tagged with `projectPath`.
4. If unmatched: event runs in the global / no-project context (same as today's chat-without-project).

### Project Settings UI

A new tab on `ProjectDetail.tsx` (probably "Channels" under the Coordinate mode):

- Lists current bindings as cards
- "+ Bind a room" button → channel picker → room picker (calls `protocol.listRooms()` for the chosen channel) → label input → save
- Per-binding: edit label, remove binding, view "last activity" timestamp

### Project Page Panel

When at least one room is bound for any channel, the channel plugin's `ProjectPagePanel` renders on the project page. The panel receives:

```ts
interface ChannelProjectPanelProps {
  projectPath: string;
  /** All this project's bindings for THIS channel (channel filtered). */
  bindings: Array<{ roomId: string; label: string }>;
  /** Bridge host the panel can call tools on. */
  bridge: McpToolHost;
}
```

Discord's panel renders forum thread list / message log / composer per binding. Slack's renders channel timeline. Email's renders thread list with unread badges. Each plugin owns the UX completely.

---

## 6. Channel-internal management page

Mount path: `/settings/channels/<id>` (e.g. `/settings/channels/discord`). Added to the existing Settings sidebar.

Surface (channel-specific; below is Discord as the worked example):

- **Connection card** — bot token + application ID (sealed in `~/.agi/secrets/`), reload button, current connection state (ready / connecting / error)
- **Server (Guild) picker** — list of guilds the bot is in, with member count + role count
- **Intents** — checkboxes per intent (`MessageContent`, `GuildMembers`, `GuildPresences`) with explanations + Discord developer-portal link
- **Read policy** — per-guild `canReadAllMessages` + `canReadPresence` + `canReadRoles` toggles
- **Role-to-workflow bindings** — table of `<role> → <workflow>` rules (e.g. "Intern" → "onboarding.mapp", "Client" → "client-intake.mapp"). Per the owner directive 2026-05-12 ("I might have a role called Intern or Client, and this gives that user an ability to create a user account with this setup even if they can't access local-id"). The "create-user-account" path produces a `pending-from-discord` entity (Tier 4 work, separate doc).
- **Aion bot identity** — display name, avatar, accent color
- **Audit log** — recent inbound/outbound message volume, error rate, last-N events

Same pattern for Slack (workspace + scopes), Telegram (bot config + group allowlist), Email (OAuth account + label mapping), WhatsApp (number + group join). Each plugin's settings page owns its UX entirely.

---

## 7. Bridge tool registration

Every channel plugin registers a family of MCP tools (auto-namespaced with channel id). These show up in:

- **Agent tool registry** — Aion can call `discord_search_messages` when chat originates from Discord context.
- **MApp Magic Apps Editor** — workflow steps can use any registered bridge tool.
- **`agi` CLI** under `agi channel discord post …` (cross-cutting CLI subcommand).

Discord's bridge-tool set (worked example):

```ts
const discordBridgeTools: ChannelBridgeToolDefinition[] = [
  defineBridgeTool({
    name: "post_message",
    description: "Post a message to a Discord room (channel / forum thread / DM).",
    input: { roomId: "string", text: "string", replyToMessageId: "string?" },
    handler: async (input, ctx) => ctx.protocol.postToRoom(input.roomId, { text: input.text, replyToMessageId: input.replyToMessageId }),
  }),
  defineBridgeTool({ name: "search_messages", ... }),
  defineBridgeTool({ name: "get_user", ... }),
  defineBridgeTool({ name: "list_members", ... }),
  defineBridgeTool({ name: "list_rooms", ... }),
  defineBridgeTool({ name: "get_user_activity", ... }),
  defineBridgeTool({ name: "aggregate_stats", description: "Roll up message activity per user over a timeframe — for leaderboards.", ... }),
];
```

The `aggregate_stats` tool is what Aion-as-scrum-master uses for check-in leaderboards + screenshot-count awards.

---

## 8. Cage + entity flow

### Cage

When a room-bound event arrives:

1. Dispatcher resolves `findProjectByRoom(channelId, roomId)` → projectPath
2. `cageProvider(roomId)` returns the project's cage (same shape as today's chat cage — `[projectPath, projectPath/k, projectPath/repos, projectPath/.agi, projectPath/.trash]`)
3. Agent tools run inside that cage exactly as if the chat had originated from the project's dashboard chat surface

### Entity binding

Channel `userId` → Aionima entity resolution:

```ts
async function resolveEntity(channelId: string, userId: string): Promise<{ entityId: string; isPending: boolean }> {
  // 1. Look up existing mapping in entity registry
  const known = await entityRegistry.findByChannel({ channelId, channelUserId: userId });
  if (known) return { entityId: known.entityId, isPending: known.isPending };

  // 2. Auto-create a pending entity
  const pending = await entityRegistry.createPending({
    source: `pending-from-${channelId}`,
    channelUserId: userId,
    displayName: await protocol.getUser(userId).then((u) => u?.displayName ?? userId),
  });
  return { entityId: pending.entityId, isPending: true };
}
```

`pending-from-<channel>` entities are stored locally, COA-tagged but not signed. Owner approves them in the dashboard's "Pending registrations" surface (separate doc — `pending-entity-flow.md`, future). Approved entities get promoted: pending → verified-on-local-id (or eventually hive-id).

---

## 9. Migration plan for the 5 existing adapters

Today's adapters: `channels/discord`, `channels/telegram`, `channels/signal`, `channels/whatsapp`, `channels/gmail` against `@agi/channel-sdk@0.1`.

Phased migration:

| Phase | Scope | Adapter(s) | Cycles |
|-------|-------|-----------|--------|
| **0** | Land the new SDK contract in `@agi/aion-sdk`. Old SDK stays alongside for compatibility | (none) | 1-2 |
| **1** | First rewrite — **Discord** — full new shape. Validates the design against the most-featured channel first | discord | 3-5 |
| **2** | Surface in dashboard — settings route, project-page slot, project-binding tab | (gateway-side) | 2-3 |
| **3** | Migrate **Telegram** + **Email** in parallel (simpler shapes) | telegram, gmail | 2-3 each |
| **4** | Migrate **Slack** + **WhatsApp** + **Signal** — added as new under the new shape (Slack is net-new; WhatsApp + Signal currently scaffold-only) | slack, whatsapp, signal | 2-3 each |
| **5** | Deprecate + remove `@agi/channel-sdk@0.1` | (cleanup) | 1 |

**Total: 16-25 cycles.** Discord lands first because (a) owner explicitly wants it back online with the new vision, (b) it has every shape we need to validate (forums, threads, DMs, roles, presence, voice), and (c) any contract gaps surface there before the cheap migrations.

**During Phase 1:** Discord's existing adapter stays on disk but `enabled: false` in config. The new Discord plugin lives at `channels/discord-v2/` (or replaces in-place on a feature branch). Once Phase 2 settings UX lands, owner flips a config switch to use the new one.

---

## 10. Open questions for owner sign-off

| # | Decision | Default if not answered |
|---|----------|------------------------|
| **OQ-1** | **Multi-binding default** — does a project's "Coordinate → Channels" tab show ALL bound rooms across all channels, or one tab per channel (Discord tab / Slack tab / Email tab)? | All bound rooms in one unified tab; channel-specific panels nest within |
| **OQ-2** | **Owner-can-override `readAllMessages`** — should this be per-guild (Discord) / per-workspace (Slack) / global? Owner directive 2026-05-12 ("Aion to read all messages even those it is not tagged in") implies global-on, but Discord ToS suggests per-room consent | Per-room with bot-presence implying consent on public channels; private rooms require explicit toggle |
| **OQ-3** | **Pending-entity owner approval surface** — is this its own dashboard page (`/identity/pending`) or a tile on the Aionima system page? | New page under `/identity/pending`, with notification badge on the dashboard nav |
| **OQ-4** | **Channel-tool exposure to non-Discord-origin chats** — if Aion is chatting in dashboard with project context, can it still call `discord_post_message`? Or only when chat originates from Discord? | Available based on project's `rooms[]` bindings — if the project is bound to a Discord room, `discord_*` tools are in the kit |
| **OQ-5** | **Scrum-master skill scope** — is this a skill bundled with the channel plugin (each channel ships its own scrum-master tools) or a single cross-channel skill that calls bridge tools generically? | Cross-channel skill in `prompts/skills/scrum-master.md`, uses bridge-tool primitives, channel-agnostic |
| **OQ-6** | **MApp-driven workflows** — when a workflow is bound to a channel/role, where does the workflow LIVE? Plugin Marketplace MApp? Per-project MApp? Owner-authored skill? | Plugin Marketplace MApp first (reusable across projects); per-project overrides shipped Phase 4+ |
| **OQ-7** | **Migration to ADF Intelligence Protocols** — is `ChannelProtocol extends IntelligenceProtocol` literal subclassing, or are they parallel interfaces with overlapping shape? | Parallel for now; both share `coa-chain` tagging via the same protocol-context object |
| **OQ-8** | **Per-project channel-credentials override** — can a project specify its own Discord bot for its rooms (multi-bot setup)? | One bot per channel globally for Phase 1; per-project bots deferred to Phase 5+ if needed |
| **OQ-9** | **Voice + audio support** — Discord supports voice channels; do we need voice-message handling beyond the existing audio-attachment shape? | Audio attachments only for Phase 1; voice-channel join is its own future scope |
| **OQ-10** | **Channel marketplace** — do new channels (Matrix, IRC, Mastodon) install from the marketplace, or do all channels ship with core agi? | Core 5 (discord, telegram, slack, gmail, signal) ship with agi; new channels via Plugin Marketplace under a new "channel" category |

---

## 11. Implementation tiers

Once this design doc is signed off, work decomposes into tynn stories:

| Story | Scope | Cycles |
|-------|-------|--------|
| **CHN-A: SDK contract** | `defineChannel` + `ChannelProtocol` + `ChannelRoom` + `ChannelEvent` + `ChannelDefinition` in `@agi/aion-sdk`; `@agi/channel-sdk@0.2` deprecation plan | 1-2 |
| **CHN-B: Discord rewrite** | Full new Discord plugin against new SDK. Includes management settings page, project-page panel, bridge tools, room mapping, intent toggles | 3-5 |
| **CHN-C: Gateway dispatcher** | `findProjectByRoom` index, cage binding, entity resolver, event-bus routing | 2-3 |
| **CHN-D: Project-binding UI** | `project.json` `rooms[]` schema, Coordinate-mode Channels tab, room picker dialog | 2-3 |
| **CHN-E: Pending-entity flow** | `pending-from-<channel>` entity state, owner-approval page, promotion to verified-on-local-id | 2-3 |
| **CHN-F: Role → workflow binding** | Channel settings page table + runtime resolver | 1-2 |
| **CHN-G: Scrum-master skill** | `prompts/skills/scrum-master.md` + `aggregate_stats` bridge tool family | 1-2 |
| **CHN-H: Discord-bridge MApp scaffold** | `defineDiscordWorkflow` example + Magic Apps Editor support | 2-3 |
| **CHN-I: Telegram migration** | Apply new SDK to existing telegram adapter | 2-3 |
| **CHN-J: Email migration** | Apply new SDK to existing gmail adapter | 2-3 |
| **CHN-K: Slack** | New under new SDK (currently scaffold-only) | 2-3 |
| **CHN-L: WhatsApp + Signal** | New under new SDK (currently scaffold-only) | 2-3 each |
| **CHN-M: Old SDK removal** | Deprecate + delete `@agi/channel-sdk@0.1` | 1 |

**Total — 26-39 cycles** across the channel-redesign epic. CHN-A through CHN-G is the MVP (delivers Discord-back-up + all the owner's directives: project-binding, role/channel workflow association, pending-entity flow, scrum-master, MApp authoring). Phases I-M are migration debt cleanup.

---

## 12. Out of scope (called out so owner doesn't expect them in this doc)

- **Voice channels + voice messages** — Discord/WhatsApp support voice; deferred to its own design doc.
- **End-to-end encrypted channels** — Signal especially. Crypto handling needs its own design discussion.
- **Channel-as-output for notifications** — Aionima already has a notifications system; channels-as-notification-destinations is a tangential concern handled by the existing notification routing.
- **AI moderation features** — content filtering, spam detection, etc. Out of scope for the redesign.
- **Cross-channel handoff** — same conversation flowing from Discord into a dashboard chat into Email, etc. Future work.
- **Multi-tenant channel-per-org** — Aionima today is single-owner. Multi-org channel access is a Hive-ID-era concern.

---

## 13. Ratification

This doc is a draft. Owner signs off section-by-section:

- [ ] §2 — Channel-as-Application thesis
- [ ] §3 — `defineChannel` SDK contract
- [ ] §4 — Room abstraction per-channel mapping
- [ ] §5 — Project ↔ Room binding contract
- [ ] §6 — Channel-internal management page
- [ ] §7 — Bridge tool family
- [ ] §8 — Cage + entity flow
- [ ] §9 — Migration plan (5 adapters, 6 phases)
- [ ] §10 — Open questions answered
- [ ] §11 — Implementation tier breakdown

Once §2-§11 are signed off, CHN-A (SDK contract) can ship as the first PR. Without sign-off the design churns expensively after code lands; with sign-off the migration debt is bounded.
