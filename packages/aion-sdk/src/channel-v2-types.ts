/**
 * Channel SDK v2 — type contract for the channel-plugin redesign.
 *
 * **CHN-A (s162) slice 1 — 2026-05-14.** Adds the new `ChannelDefinition` /
 * `ChannelProtocol` / `ChannelRoom` / `ChannelUser` / `ChannelMessage` /
 * `ChannelEvent` / `ChannelContext` types per `agi/docs/agents/channel-plugin-redesign.md`
 * §3. Coexists with the legacy `AionimaChannelPlugin` shape exported from
 * `@agi/channel-sdk`. No legacy migration in this slice — the new types
 * are additive; existing telegram/discord/email/email plugins compile
 * unchanged.
 *
 * Channels (Discord, Slack, Telegram, Email, WhatsApp, Signal) implement
 * this contract once and the gateway gets a uniform surface for: room
 * listing, project↔room binding, inbound event subscription, outbound
 * posting, message history search, and presence/role introspection.
 *
 * Migration tiers consuming these types: CHN-B (Discord rewrite, s163),
 * CHN-I (Telegram, s170), CHN-J (Gmail/Email, s171), CHN-K (Slack, s172),
 * CHN-L (WhatsApp + Signal, s173). CHN-M (s174) removes the legacy SDK.
 *
 * React component slots (`SettingsPage`, `ProjectPagePanel`) are typed
 * generously (`ComponentSlot<unknown>`-ish) because the aion-sdk package
 * doesn't depend on React directly — plugins that author UI pull React
 * themselves and the gateway treats the component as an opaque value at
 * the SDK-type boundary. Runtime React rendering happens in the host
 * dashboard, not in the SDK.
 */

// React-agnostic component slot type. `@agi/aion-sdk` doesn't depend on
// React (keeps the SDK install footprint small + lets non-React plugin
// authoring stay possible). Consumers cast their `ComponentSlot<P>`
// into this slot via `as unknown as ChannelDefinition["SettingsPage"]`
// — the host dashboard's React renderer treats it as opaque at the SDK
// boundary and unwraps at runtime.
type ComponentSlot<P> = (props: P) => unknown;

// ---------------------------------------------------------------------------
// Domain primitives
// ---------------------------------------------------------------------------

/**
 * A room inside a channel. Maps to Discord forum/channel/DM, Slack channel,
 * Telegram chat/group/channel, Email mailbox/label, etc. Channel-specific
 * encoding lives in `roomId` (free-form string); the plugin parses it.
 */
export interface ChannelRoom {
  /** Channel-scoped unique id (e.g. "1234567890:forum:42" for Discord). */
  roomId: string;
  /** Human-readable label (e.g. "#general", "Bug Reports forum"). */
  label: string;
  /**
   * What kind of room this is. Common values shipped here; plugins MAY
   * emit channel-specific kinds (Slack "huddle", Telegram "supergroup")
   * by using the open-ended `string` extension.
   */
  kind: "channel" | "forum" | "thread" | "dm" | "group" | "mailbox" | "label" | string;
  /** Parent room id when this is a thread inside a forum, etc. */
  parentRoomId?: string;
  /** Visibility scope. Maps to Discord channel/thread privacy, Slack public/private, Telegram public/private/secret. */
  privacy: "public" | "private" | "secret";
  /** Channel-specific metadata (member count, topic, archived state, ...). */
  meta?: Record<string, unknown>;
}

/**
 * A user as seen by the channel. Resolves to an Aionima entity via the
 * entity-binding layer — which may map to a `pending-from-<channel>`
 * entity until owner promotes (see CHN-E §8 of the redesign doc).
 */
export interface ChannelUser {
  /** Channel-scoped user id. */
  userId: string;
  /** Display name as the channel knows it. */
  displayName: string;
  /** Username / handle when distinct from displayName. */
  username?: string;
  /** Avatar URL. */
  avatarUrl?: string;
  /**
   * Channel-specific role memberships (Discord role ids, Slack workspace
   * role, Telegram admin status, ...). Free-form strings — the channel
   * defines its own role vocabulary.
   */
  roles?: string[];
  /** Online / offline / away / etc when the channel exposes presence. */
  presence?: "online" | "away" | "offline" | "do-not-disturb" | string;
  /** Channel-specific activity (game, status text, ...). */
  activity?: string;
}

/** Attachment shape — common across all channels. */
export interface ChannelMessageAttachment {
  kind: "image" | "audio" | "video" | "file";
  url: string;
  mime?: string;
}

/** A normalized message in the inbound event stream. */
export interface ChannelMessage {
  messageId: string;
  roomId: string;
  /** Channel-scoped user id — resolves to an entity via the binding layer. */
  authorId: string;
  text: string;
  attachments?: ChannelMessageAttachment[];
  /** When this message is a reply to a specific other message in the same room. */
  replyToMessageId?: string;
  /** When this message belongs to a Discord/Slack thread; root message of the thread. */
  threadRootMessageId?: string;
  /** ISO 8601 timestamp. */
  sentAt: string;
  /** ISO 8601 timestamp when the message was edited; absent if never edited. */
  editedAt?: string;
  /** Did the message @-mention this channel's bot. */
  mentionsBot: boolean;
}

/**
 * Inbound event the channel emits to the gateway. Plugin subscribes via
 * `ChannelProtocol.onEvent` or `subscribeRoom`; the gateway dispatcher
 * routes to workflow or agent based on role/channel bindings (CHN-C).
 */
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

// ---------------------------------------------------------------------------
// Bridge tool descriptor (channel-scoped per CHN-G)
// ---------------------------------------------------------------------------

/**
 * A bridge tool the channel exposes to agents/MApps via the per-session
 * MicroMcpServer. Auto-namespaced with channel id at registration time
 * (e.g. `discord_post_message`, `telegram_search_messages`).
 *
 * Kept minimal here — the existing `AgentToolDefinition` shape in
 * `@agi/plugins` provides the richer surface for now; CHN-G layers the
 * `aggregate_stats` family on top.
 */
export interface ChannelBridgeToolDefinition {
  /** Tool name without the channel-id prefix (gateway prepends e.g. "discord_"). */
  name: string;
  description: string;
  /** JSON-schema-like input descriptor. */
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Synchronous OR async handler. Receives validated input + channel context. */
  handler: (input: Record<string, unknown>, ctx: ChannelContext) => unknown | Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Context handed to plugin at protocol-construction time
// ---------------------------------------------------------------------------

/**
 * Cage handle — placeholder type for the CHN-C cage system. The cage
 * scopes channel events to a bound project's tool surface. Full type
 * lands when CHN-C ships (s164); for now plugins receive an opaque
 * handle they don't need to introspect.
 */
export interface ChannelCage {
  /** Project path that owns this cage. */
  projectPath: string;
  /** Free-form metadata the gateway attaches. */
  meta?: Record<string, unknown>;
}

/**
 * Entity binding result from the gateway's entity resolver. CHN-E
 * formalizes the `pending-from-<channel>` flow; this contract just
 * surfaces the resolved id + pending flag.
 */
export interface ChannelEntityBinding {
  /** Resolved Aionima entity id (e.g. "#E1.<hash>" or "pending-from-discord:1234"). */
  entityId: string;
  /** True when the resolved entity is in the pending-approval queue. */
  isPending: boolean;
}

/**
 * Context handed to `ChannelDefinition.createProtocol`. Gateway primitives
 * the channel uses without coupling to gateway internals.
 */
export interface ChannelContext {
  /** Channel-specific config (from gateway.json `channels[].config`). */
  config: Record<string, unknown>;
  /** Channel-scoped logger (prefix already includes the channel id). */
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /**
   * Cage provider — returns the cage bound to a given room id, or null
   * when the room isn't yet bound to any project. CHN-C wires this end-
   * to-end; plugins consume the cage handle when forwarding events.
   */
  cageProvider: (roomId: string) => ChannelCage | null;
  /**
   * Entity resolver — maps channel userId → Aionima entity. Returns a
   * pending entity until owner promotes (CHN-E). Plugins call this when
   * normalizing inbound events.
   */
  resolveEntity: (userId: string) => Promise<ChannelEntityBinding>;
}

// ---------------------------------------------------------------------------
// The protocol surface — what every channel implements
// ---------------------------------------------------------------------------

/**
 * The protocol surface every channel implements. `start()` returns a
 * teardown handle so the gateway can shut the channel down cleanly on
 * restart / config change.
 */
export interface ChannelProtocol {
  /** Initialize + connect to the underlying transport. Returns a teardown handle. */
  start(): Promise<{ stop: () => Promise<void> }>;
  /** Subscribe to ALL inbound events from this channel. Returns an unsubscribe fn. */
  onEvent(handler: (event: ChannelEvent) => void): () => void;
  /** List all rooms this channel can see. */
  listRooms(): Promise<ChannelRoom[]>;
  /** Get one room by id. Returns null when the bot can't see the room. */
  getRoom(roomId: string): Promise<ChannelRoom | null>;
  /** Subscribe to events for a SPECIFIC room — filtered at the source where possible. */
  subscribeRoom(roomId: string, handler: (event: ChannelEvent) => void): () => void;
  /** Post a message to a room. Returns the persisted message. */
  postToRoom(
    roomId: string,
    message: {
      text: string;
      replyToMessageId?: string;
      attachments?: ChannelMessageAttachment[];
    },
  ): Promise<ChannelMessage>;
  /** Read message history for a room. Paged; returns nextCursor when more. */
  searchMessages(
    roomId: string,
    opts: { fromTs?: string; toTs?: string; limit?: number; cursor?: string },
  ): Promise<{ messages: ChannelMessage[]; nextCursor?: string }>;
  /** Get one user. */
  getUser(userId: string): Promise<ChannelUser | null>;
  /** List members of a room (or a workspace/guild scope). */
  listMembers(scope: { roomId?: string; guildId?: string }): Promise<ChannelUser[]>;
}

// ---------------------------------------------------------------------------
// React component slot props (typed loosely — see file header)
// ---------------------------------------------------------------------------

/** Props handed to a channel's SettingsPage component. */
export interface ChannelSettingsPageProps {
  /** Current config (the same object stored in gateway.json `channels[].config`). */
  config: Record<string, unknown>;
  /** Mutate the config; gateway persists. */
  onConfigChange: (next: Record<string, unknown>) => void;
}

/** Props handed to a channel's ProjectPagePanel component. */
export interface ChannelProjectPanelProps {
  projectPath: string;
  /** Rooms currently bound to this project for this channel. */
  boundRooms: ChannelRoom[];
}

// ---------------------------------------------------------------------------
// Read-policy declaration
// ---------------------------------------------------------------------------

/**
 * Privileged-intents / read-policy declaration. Surfaced in the Settings
 * UI; owner toggles per-room or per-guild. Plugins declare what they
 * CAN read here; runtime gating goes through the resolved policy.
 */
export interface ChannelReadPolicy {
  /** Can read messages the bot is NOT @-mentioned in? */
  canReadAllMessages: { configurable: boolean; defaultOn: boolean };
  /** Can read user presence (online/offline/activity)? */
  canReadPresence: { configurable: boolean; defaultOn: boolean };
  /** Can read role memberships? */
  canReadRoles: { configurable: boolean; defaultOn: boolean };
  /** Vendor-specific intents the plugin needs (Discord intents, Slack scopes). */
  nativeIntents?: string[];
}

// ---------------------------------------------------------------------------
// The full ChannelDefinition shape (returned by defineChannelV2)
// ---------------------------------------------------------------------------

export interface ChannelDefinition {
  /** Stable identifier (e.g. "discord", "telegram"). */
  id: string;
  /** Display name (e.g. "Discord", "Telegram"). */
  displayName: string;
  /** Vendor logo URL or icon name. */
  icon?: string;

  /**
   * Build the protocol implementation. Called once per gateway boot
   * (or per config change) with channel config + gateway primitives.
   */
  createProtocol: (ctx: ChannelContext) => ChannelProtocol;

  /**
   * React component for the channel's settings page. Mounted at
   * /settings/channels/<id>. The plugin owns its own UX completely.
   */
  SettingsPage: ComponentSlot<ChannelSettingsPageProps>;

  /**
   * React component slotted into ProjectDetail.tsx when the project
   * has at least one room bound to this channel. Renders the channel's
   * view of bound rooms. Optional — if omitted the gateway shows a
   * generic "bound rooms" list.
   */
  ProjectPagePanel?: ComponentSlot<ChannelProjectPanelProps>;

  /**
   * Bridge tools — registered against the per-session MicroMcpServer.
   * Auto-namespaced with channel id (gateway prepends e.g. `discord_`).
   */
  bridgeTools: ChannelBridgeToolDefinition[];

  /** Privileged-intents / read-policy declaration (see ChannelReadPolicy). */
  readPolicy: ChannelReadPolicy;
}
