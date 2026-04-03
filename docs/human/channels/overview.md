# Channels — How They Work

A channel is a bidirectional adapter between an external messaging platform and the Aionima agent pipeline. Each channel receives inbound messages from its platform, normalizes them into a common `AionimaMessage` format, and routes them to the agent. When the agent produces a response, the channel delivers it back to the original sender.

---

## Channel Lifecycle

### 1. Discover

At gateway startup, `discoverChannelPlugins()` scans the `channels/` directory. Each subdirectory (e.g. `channels/telegram/`) is treated as a potential channel plugin. Discovery checks for a `package.json` with an `"aionima"` manifest block.

Example channel `package.json` manifest:

```json
{
  "name": "@aionima/channel-telegram",
  "version": "1.0.0",
  "aionima": {
    "category": "integration",
    "entry": "dist/index.js"
  }
}
```

### 2. Load

The discovered plugin's entry file is dynamically imported. The entry must export an object that satisfies the `AionimaPlugin` interface:

```typescript
export interface AionimaPlugin {
  activate(api: AionimaPluginAPI): Promise<void>;
  deactivate?(): Promise<void>;
}
```

### 3. Activate

The `activate(api)` function is called with the plugin API context. The channel plugin calls `api.registerChannel(channelPlugin)` to register itself with the channel registry. It also reads its configuration via `api.getChannelConfig(channelId)`.

### 4. Start

After all plugins are activated, `channelRegistry.startAll()` is called. Each registered channel plugin's `start()` method is invoked, which begins polling, connects to the platform's WebSocket, or mounts a webhook route.

If a channel fails to start, it enters an exponential backoff retry loop (initial 5s, maximum 5 minutes, up to 10 attempts). After 10 failed attempts, the channel is marked as failed and stops retrying. This does not crash the gateway.

### 5. Run

The channel is running and processing messages. Inbound messages are emitted as events to the `InboundRouter`.

### 6. Stop / Restart

Channels can be stopped and restarted via the dashboard (Communication → [Channel Name]) or via the channel API. The channel plugin's `stop()` method is called, which disconnects from the platform and cleans up resources. Restart calls `stop()` followed by `start()`.

---

## Channel SDK Interface

All channel adapters must implement the `AionimaChannelPlugin` interface from `@aionima/channel-sdk`:

```typescript
interface AionimaChannelPlugin {
  readonly id: ChannelId;          // "telegram", "discord", etc.
  readonly meta: ChannelMeta;      // name, version, description
  readonly capabilities: ChannelCapabilities;

  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;

  on(event: "message", handler: (msg: AionimaMessage) => void): this;
  on(event: "error", handler: (err: Error) => void): this;
}
```

The `capabilities` field declares what the channel supports:

```typescript
interface ChannelCapabilities {
  text: boolean;      // plain text messages
  media: boolean;     // images, files, etc.
  voice: boolean;     // audio messages
  reactions: boolean; // emoji reactions
  threads: boolean;   // threaded replies
  ephemeral: boolean; // messages visible only to sender
}
```

---

## Normalized Message Format

All inbound messages — regardless of channel — are normalized to `AionimaMessage`:

```typescript
interface AionimaMessage {
  id: string;              // unique message ID
  channelId: ChannelId;    // "telegram", "discord", etc.
  channelUserId: string;   // platform-specific user ID
  timestamp: string;       // ISO-8601
  content: MessageContent; // text, media, or voice
  replyTo?: string;        // message ID being replied to
  threadId?: string;       // thread context
  metadata?: Record<string, unknown>; // platform-specific extras
}

type MessageContent =
  | { type: "text"; text: string }
  | { type: "media"; url: string; mimeType: string; caption?: string }
  | { type: "voice"; url: string; duration: number };
```

The normalization step happens inside each channel adapter before the message is emitted to the `InboundRouter`.

---

## Message Flow

```
Platform (Telegram, Discord, etc.)
    |
    | platform-native event
    v
Channel Adapter
    |
    | normalize to AionimaMessage
    v
InboundRouter.route(message)
    |
    | 1. look up or create entity for channelUserId
    | 2. check DM policy (pairing required or open)
    | 3. check rate limit for entity
    | 4. enqueue to MessageQueue
    v
MessageQueue (SQLite-backed)
    |
    | QueueConsumer polls
    v
AgentSessionManager
    |
    | retrieve or create session
    | assemble system prompt
    | match skills
    | recall memory
    v
AgentInvoker → LLM API
    |
    | response text
    v
OutboundDispatcher
    |
    | route response back to originating channel
    v
Channel Adapter → Platform
```

---

## Channel Configuration Patterns

Every channel entry in `aionima.json` follows the same structure:

```json
{
  "id": "channel-name",
  "enabled": true,
  "config": {
    "someKey": "$ENV{SOME_SECRET}"
  }
}
```

- `id` — must match the channel plugin's registered ID.
- `enabled` — set to `false` to disable a channel without removing its config.
- `config` — channel-specific configuration. Use `$ENV{VAR}` references for secrets.

Secrets should always go in `.env`, referenced by `$ENV{VAR_NAME}` in `aionima.json`. The `aionima doctor` command checks for hardcoded secrets in the config file.

---

## Owner Configuration

For each channel, you can register your own user ID so Aionima recognizes you as the owner. This grants sealed-tier access (all tools, no rate limits):

```json
{
  "owner": {
    "displayName": "Your Name",
    "dmPolicy": "pairing",
    "channels": {
      "telegram": "123456789",
      "discord": "987654321098765432",
      "gmail": "you@example.com",
      "signal": "+15555550100",
      "whatsapp": "+15555550100"
    }
  }
}
```

`dmPolicy` controls how non-owner users are handled:
- `"pairing"` — unknown senders must complete a pairing code flow to gain access. This is the default and recommended setting.
- `"open"` — all senders are allowed through with unverified-tier access.

---

## Channel Status and Controls in Dashboard

Each channel has a dedicated page under Communication in the dashboard sidebar. The page shows:

- **Status badge** — running (green), stopped (gray), error (red), or reconnecting (yellow).
- **Start / Stop / Restart** — buttons send `POST /api/channels/{id}/start`, `.../stop`, or `.../restart`.
- **Message log** — a live feed of messages flowing through the channel. Includes sender entity alias, message content preview, and timestamp.
- **Error details** — if the channel is in error state, the last error message is displayed with a timestamp.

Channel status is refreshed in real-time via WebSocket events. You do not need to reload the page to see status changes.

---

## Adding a New Channel

To add support for a new messaging platform:

1. Create a directory under `channels/` (e.g. `channels/myplatform/`).
2. Add a `package.json` with an `"aionima"` manifest block.
3. Implement the `AionimaPlugin` interface, calling `api.registerChannel()` in `activate()`.
4. Implement the `AionimaChannelPlugin` interface for the actual adapter.
5. Add the channel to `aionima.json` under `"channels"`.
6. Rebuild: `pnpm build`.

The channel SDK test harness in `packages/channel-sdk/src/test-harness.ts` provides utilities for testing channel adapters without connecting to the live platform.
