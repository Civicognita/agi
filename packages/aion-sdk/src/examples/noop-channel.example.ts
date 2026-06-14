/**
 * Reference example: a fully-formed channel definition using the new
 * `defineChannelV2` SDK from CHN-A (s162).
 *
 * **What this file is:** a minimum-viable channel implementation that
 * compiles against `ChannelDefinition` and is intentionally a no-op at
 * runtime. Plugin authors migrating from the legacy SDK (s163 Discord,
 * s170 Telegram, s171 Email, s172 Slack, s173 WhatsApp/Signal) start by
 * copying this file and replacing the noop stubs with the real channel-
 * specific logic.
 *
 * **What this file is NOT:** it's not registered, not loaded by the
 * gateway, not re-exported from `index.ts`. Pure compile-time reference.
 * Lives under `src/examples/` so TypeScript validates it on every
 * `pnpm typecheck` — if the SDK contract changes in a breaking way, this
 * file breaks loudly, forcing a docs-and-example update in the same
 * commit.
 *
 * Migration recipe (per s162 acceptance criterion 3):
 *   1. Copy this file into your channel package as `channel-def.ts`.
 *   2. Replace `id: "noop"` with your channel's stable id ("discord",
 *      "telegram", ...).
 *   3. Implement `createProtocol` against the channel's SDK (discord.js,
 *      grammy, @slack/bolt, etc).
 *   4. Author `SettingsPage` + optional `ProjectPagePanel` as React
 *      components in your plugin's UI module.
 *   5. Build out `bridgeTools` for the per-session MicroMcpServer.
 *   6. Declare `readPolicy` — what intents the plugin requires + what's
 *      togglable per-instance.
 *   7. Default-export the resulting `defineChannelV2({...})` value.
 *
 * Reference: agi/docs/agents/channel-plugin-redesign.md §3.
 */

import { defineChannelV2 } from "../define-channel-v2.js";
import type {
  ChannelDefinition,
  ChannelProtocol,
  ChannelMessage,
} from "../channel-v2-types.js";

// React-ish component slot. The SDK doesn't depend on React; the host
// dashboard treats this as an opaque value and unwraps at render time.
const NoopSettingsPage = () => null;
const NoopProjectPanel = () => null;

/**
 * Build the noop protocol. Real plugins return an object whose methods
 * call into the channel's SDK (e.g. discord.js Client). All methods
 * return either empty results or static defaults — enough to satisfy
 * the contract without actually connecting to anything.
 */
function buildNoopProtocol(): ChannelProtocol {
  return {
    // start() — connect to the transport. Returns a teardown handle the
    // gateway calls on shutdown / config change. Noop just returns the
    // handle immediately.
    start: async () => ({ stop: async () => undefined }),

    // onEvent() — subscribe to ALL inbound events. Returns an
    // unsubscribe function. Noop never emits anything.
    onEvent: () => () => undefined,

    // listRooms() / getRoom() — room directory. Real plugins query the
    // underlying SDK (Discord guilds + channels, Slack workspaces +
    // channels, Telegram chats, etc).
    listRooms: async () => [],
    getRoom: async () => null,

    // subscribeRoom() — filtered event stream for one room. Source-side
    // filtering is preferred when the SDK supports it (less event noise
    // for the gateway dispatcher).
    subscribeRoom: () => () => undefined,

    // postToRoom() — outbound. Real plugins call channel-specific send
    // APIs and return the persisted message with the server-assigned id.
    postToRoom: async (roomId, message): Promise<ChannelMessage> => ({
      messageId: `noop-${Date.now().toString()}`,
      roomId,
      authorId: "noop-bot",
      text: message.text,
      sentAt: new Date().toISOString(),
      mentionsBot: false,
    }),

    // searchMessages() — read history with optional time-frame and
    // paging cursor. Returns an empty page when there are no more.
    searchMessages: async () => ({ messages: [] }),

    // getUser() / listMembers() — entity discovery. Real plugins
    // normalize the channel's user shape into ChannelUser (roles,
    // presence, activity) when available.
    getUser: async () => null,
    listMembers: async () => [],
  };
}

/**
 * The reference channel definition. Type-asserted as `ChannelDefinition`
 * to guarantee compile-time contract checking — any drift between this
 * example and the type contract surfaces as a typecheck error.
 */
const noopChannel: ChannelDefinition = defineChannelV2({
  id: "noop",
  displayName: "Noop Channel (reference example)",
  icon: undefined,

  // createProtocol() is called once per gateway boot with channel
  // config + gateway primitives (logger, cageProvider, resolveEntity).
  // Noop ignores ctx entirely; real plugins typically destructure
  // logger + capture ctx for the lifetime of the protocol.
  createProtocol: (_ctx) => buildNoopProtocol(),

  // React components — typed loosely at the SDK boundary so the SDK
  // package doesn't depend on React. Cast through `unknown` to silence
  // structural mismatches; the host dashboard treats these as opaque.
  SettingsPage: NoopSettingsPage as unknown as ChannelDefinition["SettingsPage"],
  ProjectPagePanel: NoopProjectPanel as unknown as ChannelDefinition["ProjectPagePanel"],

  // Bridge tools — registered against per-session MicroMcpServer with
  // the channel id auto-prepended (so this tool becomes `noop_ping`).
  // Real plugins typically expose 4-7 tools (search_messages, get_user,
  // list_members, get_user_activity, resolve_project, aggregate_stats,
  // available_rooms — see Discord channel for the full pattern).
  bridgeTools: [
    {
      name: "ping",
      description: "Reference bridge tool — returns 'pong'. Plugin authors replace with real tools.",
      inputSchema: { type: "object", properties: {} },
      handler: () => "pong",
    },
  ],

  // Read policy — declarative + toggleable. Plugins declare what they
  // CAN read; runtime gating applies the resolved per-instance policy.
  // Noop opts into nothing privileged.
  readPolicy: {
    canReadAllMessages: { configurable: true, defaultOn: false },
    canReadPresence: { configurable: true, defaultOn: false },
    canReadRoles: { configurable: true, defaultOn: false },
    nativeIntents: [], // real Discord channel declares ["Guilds", "GuildMessages", "MessageContent"]
  },
});

export default noopChannel;
