# Adding a New Channel Adapter

This guide walks through every step required to add a new messaging channel to Aionima. Use `channels/telegram/` as the reference implementation throughout.

## Overview

A channel adapter is a plugin that lives in `channels/<name>/` and registers an `AionimaChannelPlugin` via `api.registerChannel()` during activation. The gateway then starts it, wires inbound messages to the queue, and routes outbound replies back through the channel.

## Step 1: Create the Directory Structure

```
channels/
  <name>/
    src/
      index.ts       # Plugin entry point + channel plugin factory
      config.ts      # Config type + isTelegramConfig-style validator
      normalizer.ts  # Message normalization to AionimaMessage
      outbound.ts    # Send logic
      security.ts    # Optional security adapter (rate limit, allowlist)
    package.json
    tsconfig.json
```

Create the directory:

```bash
mkdir -p /home/wishborn/temp_core/agi/channels/<name>/src
```

## Step 2: Write package.json with the `"aionima"` Manifest Field

The discovery system reads the `"aionima"` field in `package.json`. For channels the required field is `category: "integration"`.

```json
{
  "name": "@aionima/channel-<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "aionima": {
    "id": "channel-<name>",
    "name": "<Name> Channel",
    "description": "<Name> messaging channel adapter",
    "category": "integration",
    "entry": "./src/index.ts"
  },
  "dependencies": {
    "@aionima/channel-sdk": "workspace:*",
    "@aionima/plugins": "workspace:*"
  }
}
```

Key rules:
- `"aionima".id` must be unique across all plugins. Use the pattern `channel-<name>`.
- `"aionima".category` must be `"integration"` — this is how `discoverChannelPlugins()` distinguishes channels from other plugins.
- `"aionima".entry` must point to the TypeScript source (not a compiled dist). The plugin loader resolves it from `channelsDir`.
- `"type": "module"` is required for ESM compatibility.

## Step 3: Write the Channel SDK Config Adapter

```ts
// channels/<name>/src/config.ts
export interface <Name>Config {
  apiKey: string;
  // ...channel-specific fields
}

export function is<Name>Config(c: unknown): c is <Name>Config {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof (c as Record<string, unknown>).apiKey === "string"
  );
}

export function createConfigAdapter() {
  return {
    validate: (raw: unknown): { valid: boolean; errors: string[] } => {
      if (!is<Name>Config(raw)) {
        return { valid: false, errors: ["apiKey is required"] };
      }
      return { valid: true, errors: [] };
    },
  };
}
```

## Step 4: Normalize Inbound Messages

The channel SDK requires all inbound messages to be normalized to `AionimaMessage`. Import from `@aionima/channel-sdk`.

```ts
// channels/<name>/src/normalizer.ts
import type { AionimaMessage } from "@aionima/channel-sdk";

export const <NAME>_CHANNEL_ID = "<name>" as const;

export function normalizeMessage(raw: YourLibraryMessage): AionimaMessage | null {
  const text = raw.text;
  if (!text) return null;

  return {
    id: String(raw.id),
    channelId: <NAME>_CHANNEL_ID,
    channelUserId: String(raw.from.id),
    content: { type: "text", text },
    metadata: {
      firstName: raw.from.first_name,
    },
    receivedAt: new Date(raw.date * 1000).toISOString(),
  };
}
```

## Step 5: Implement the Plugin Entry Point

The entry file must satisfy two contracts simultaneously:

1. `AionimaChannelPlugin` — the channel itself (id, meta, capabilities, config, gateway, outbound, messaging)
2. `AionimaPlugin` default export — the plugin lifecycle hook (`activate` / `deactivate`)

```ts
// channels/<name>/src/index.ts
import type { AionimaChannelPlugin, AionimaMessage } from "@aionima/channel-sdk";
import type { AionimaPlugin, AionimaPluginAPI } from "@aionima/plugins";
import { type <Name>Config, is<Name>Config, createConfigAdapter } from "./config.js";
import { <NAME>_CHANNEL_ID, normalizeMessage } from "./normalizer.js";
import { sendOutbound } from "./outbound.js";

export function create<Name>Plugin(config: <Name>Config): AionimaChannelPlugin {
  if (!is<Name>Config(config)) {
    throw new Error("Invalid <Name> config");
  }

  let running = false;
  let messageHandler: ((msg: AionimaMessage) => Promise<void>) | null = null;

  // Initialize your SDK client here
  // const client = new YourClient(config.apiKey);

  return {
    id: <NAME>_CHANNEL_ID,

    meta: {
      name: "<Name>",
      version: "0.1.0",
      description: "<Library>-based <Name> adapter",
    },

    capabilities: {
      text: true,
      media: false,
      voice: false,
      reactions: false,
      threads: false,
      ephemeral: false,
    },

    config: createConfigAdapter(),

    gateway: {
      start: async () => {
        // Start polling or webhook listener
        running = true;
      },
      stop: async () => {
        // Stop cleanly
        running = false;
      },
      isRunning: () => running,
    },

    outbound: {
      send: async (channelUserId, content) => {
        await sendOutbound(channelUserId, content);
      },
    },

    messaging: {
      onMessage: (handler) => {
        messageHandler = handler;
      },
    },
  };
}

// Plugin lifecycle — called by the plugin loader at startup
export default {
  async activate(api: AionimaPluginAPI): Promise<void> {
    const channelConfig = api.getChannelConfig("<name>");
    if (!channelConfig?.enabled) return;
    const plugin = create<Name>Plugin(channelConfig.config as <Name>Config);
    api.registerChannel(plugin);
  },
} satisfies AionimaPlugin;
```

`api.getChannelConfig("<name>")` reads from `aionima.json` under the `channels` array. It returns `undefined` if the channel is not configured, and `{ enabled: false, ... }` if it is configured but disabled.

## Step 6: Wire Inbound Messages to the Queue

This happens automatically. After `channelRegistry.startAll()` is called in `packages/gateway-core/src/server-startup.ts`, each channel's `messaging.onMessage` handler is connected to the inbound router, which enqueues messages. You do not need to modify `server-startup.ts`.

The key is that your `messaging.onMessage` callback must be called whenever the channel receives a message. The gateway assigns the handler; your `gateway.start()` must begin delivering messages to it.

## Step 7: Add Channel Configuration to aionima.json

For the channel to be loaded, add it to the `channels` array in `aionima.json`:

```json
{
  "channels": [
    {
      "id": "<name>",
      "enabled": true,
      "config": {
        "apiKey": "your-api-key-here"
      }
    }
  ]
}
```

## Step 8: Deploy

The production deployment directory (`/opt/aionima/`) is its own git clone. `scripts/deploy.sh` runs `git pull` to update it, then `pnpm install --frozen-lockfile && pnpm build` to rebuild.

New channel directories committed to the repo are automatically included when deploy pulls. No rsync or manual sync is needed.

If your channel has a compiled `dist/` that needs to be hashed for backend-change detection, add it to `BACKEND_DIRS` in `deploy.sh`:

```bash
BACKEND_DIRS=(
  "cli/dist"
  "packages/gateway-core/dist"
  "channels/telegram/dist"
  "channels/discord/dist"
  "channels/gmail/dist"
  "channels/<name>/dist"   # Add this line
)
```

## Step 9: Add a Dashboard Communications Page

### Create the route file

```tsx
// ui/dashboard/src/routes/comms-<name>.tsx
import { ChannelPage } from "@/components/ChannelPage.js";

export default function Comms<Name>Page() {
  return <ChannelPage channelId="<name>" channelName="<Name>" />;
}
```

`ChannelPage` handles everything: status badge, Start/Stop/Restart controls, filtered message log with pagination. Pass `channelId` (must match the plugin's `id` field) and `channelName` (display label).

### Add to router.tsx

```tsx
// ui/dashboard/src/router.tsx
import Comms<Name>Page from "./routes/comms-<name>.js";

// Inside the children array:
{ path: "comms/<name>", element: <Comms<Name>Page /> },
```

### Add to AppSidebar.tsx

```tsx
// ui/dashboard/src/components/AppSidebar.tsx
// Inside the "Communication" section items array:
{ to: "/comms/<name>", label: "<Name>" },
```

## Files to Modify

| File | Change |
|------|--------|
| `channels/<name>/package.json` | Create — manifest with `"aionima"` field |
| `channels/<name>/src/index.ts` | Create — plugin entry + channel factory |
| `channels/<name>/src/config.ts` | Create — config type and validator |
| `channels/<name>/src/normalizer.ts` | Create — message normalization |
| `channels/<name>/src/outbound.ts` | Create — send logic |
| `aionima.json` | Add channel entry to `channels[]` array |
| `scripts/deploy.sh` | Add to `BACKEND_DIRS` if channel compiles to `dist/` |
| `ui/dashboard/src/routes/comms-<name>.tsx` | Create — thin wrapper around `ChannelPage` |
| `ui/dashboard/src/router.tsx` | Add route for `/comms/<name>` |
| `ui/dashboard/src/components/AppSidebar.tsx` | Add item to Communication section |

## Verification Checklist

- [ ] `channels/<name>/package.json` has `"aionima"` field with `category: "integration"`
- [ ] `"aionima".entry` resolves to an existing file
- [ ] `pnpm build` — no compile errors
- [ ] `pnpm typecheck` — passes
- [ ] Gateway starts: `pnpm dev` — no errors at plugin discovery
- [ ] Channel appears in `GET /api/channels` response
- [ ] Dashboard `/comms/<name>` renders the status card
- [ ] With a valid `apiKey`, channel status transitions to `running`
- [ ] Inbound test message appears in the comms log at `/comms/<name>`
- [ ] `api.getChannelConfig("<name>")` returns correct config (check with `curl /api/channels/<name>`)
