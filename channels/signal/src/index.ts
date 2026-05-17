import type {
  AionimaChannelPlugin,
  AionimaMessage,
} from "@agi/sdk";
import type { AionimaPlugin, AionimaPluginAPI } from "@agi/plugins";
import { createSignalChannelDefV2 } from "./channel-def.js";

import {
  type SignalConfig,
  isSignalConfig,
  createConfigAdapter,
} from "./config.js";
import {
  SIGNAL_CHANNEL_ID,
  normalizeMessage,
  hashPhoneNumber,
} from "./normalizer.js";
import { sendOutbound } from "./outbound.js";
import { createSecurityAdapter } from "./security.js";
import { SignalCliClient } from "./signal-cli-client.js";

// Re-exports for consumer convenience
export type { SignalConfig } from "./config.js";
export { isSignalConfig } from "./config.js";
export {
  normalizeMessage,
  buildDisplayName,
  hashPhoneNumber,
  SIGNAL_CHANNEL_ID,
} from "./normalizer.js";
export { splitText } from "./outbound.js";
export type { SignalMessage, SignalCliConfig } from "./signal-cli-client.js";

// ---------------------------------------------------------------------------
// EntityStore interface (minimal surface used for hash persistence)
// ---------------------------------------------------------------------------

/** Minimal EntityStore surface used by the Signal plugin for persistence. */
export interface SignalEntityStore {
  upsertPhoneHash(channel: string, hash: string, rawPhone: string): Promise<void>;
  lookupPhoneHash(channel: string, hash: string): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully-wired {@link AionimaChannelPlugin} for Signal.
 *
 * Uses signal-cli in HTTP/REST mode via native `fetch` — no npm Signal
 * protocol library required. Inbound messages are received via polling
 * (`GET /v1/receive/{number}`) at the configured interval.
 *
 * Graceful degradation: if signal-cli is unreachable at startup or during
 * polling, a warning is logged and the gateway continues without crashing.
 *
 * @param config - Validated Signal configuration.
 * @param entityStore - Optional entity store for hash→phone persistence
 *   across gateway restarts. When provided, the hash→phone map is written
 *   to the database on each inbound message and read on outbound sends.
 * @throws {Error} If `config` fails runtime validation.
 *
 * @example
 * ```ts
 * const plugin = createSignalPlugin({
 *   signalCliUrl: "http://localhost:8080",
 *   accountNumber: "+14155552671",
 * });
 * registry.register(plugin);
 * await registry.startChannel("signal");
 * ```
 */
export function createSignalPlugin(
  config: SignalConfig,
  entityStore?: SignalEntityStore,
): AionimaChannelPlugin {
  if (!isSignalConfig(config)) {
    throw new Error(
      "Invalid Signal config: signalCliUrl and accountNumber are required",
    );
  }

  const client = new SignalCliClient({
    baseUrl: config.signalCliUrl,
    accountNumber: config.accountNumber,
  });

  let running = false;
  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  let messageHandler: ((message: AionimaMessage) => Promise<void>) | null = null;

  // Reverse map: SHA-256 hash → raw E.164 phone number.
  // Populated on each inbound message so outbound can resolve the recipient.
  // The DB (via entityStore) is the primary store; this map is an in-memory cache.
  const hashToPhone = new Map<string, string>();

  const pollingIntervalMs = config.pollingIntervalMs ?? 2_000;

  async function poll(): Promise<void> {
    try {
      const messages = await client.receive();
      if (messageHandler === null) return;

      for (const msg of messages) {
        // Store the reverse mapping before normalizing (which hashes the phone)
        const rawPhone = msg.envelope.source;
        const hashedPhone = hashPhoneNumber(rawPhone);

        // Update in-memory cache
        hashToPhone.set(hashedPhone, rawPhone);

        // Persist to DB so mapping survives restarts
        if (entityStore !== undefined) {
          try {
            await entityStore.upsertPhoneHash(SIGNAL_CHANNEL_ID as string, hashedPhone, rawPhone);
          } catch (err) {
            console.warn("[signal] failed to persist phone hash:", err instanceof Error ? err.message : String(err));
          }
        }

        const normalized = normalizeMessage(msg);
        if (normalized === null) continue;
        await messageHandler(normalized);
      }
    } catch (err) {
      // Graceful degradation — log warning, don't crash the polling loop
      console.warn("[signal] Polling error:", err instanceof Error ? err.message : String(err));
    }
  }

  const security = createSecurityAdapter({
    allowedNumbers: config.allowedNumbers,
    rateLimitPerMinute: config.rateLimitPerMinute,
  });

  return {
    id: SIGNAL_CHANNEL_ID,

    meta: {
      name: "Signal",
      version: "0.1.0",
      description: "signal-cli REST adapter with polling — no external npm deps",
    },

    capabilities: {
      text: true,
      media: true,
      voice: true,
      reactions: false,
      threads: false,
      ephemeral: false,
    },

    config: createConfigAdapter(),

    gateway: {
      start: async () => {
        const healthy = await client.healthCheck();
        if (!healthy) {
          console.warn(
            "[signal] signal-cli is unreachable at startup — polling will retry",
          );
        }

        pollingTimer = setInterval(() => {
          void poll();
        }, pollingIntervalMs);

        running = true;
      },

      stop: async () => {
        if (pollingTimer !== null) {
          clearInterval(pollingTimer);
          pollingTimer = null;
        }
        running = false;
      },

      isRunning: () => {
        if (!running) return false;
        // Async health check is not feasible in a sync method;
        // return the polling state as the primary indicator.
        return pollingTimer !== null;
      },
    },

    outbound: {
      send: async (channelUserId: string, content) => {
        // channelUserId is the SHA-256 hash — resolve to E.164.
        // Check in-memory cache first, then fall back to DB.
        let phone = hashToPhone.get(channelUserId);
        if (phone === undefined && entityStore !== undefined) {
          phone = await entityStore.lookupPhoneHash(SIGNAL_CHANNEL_ID as string, channelUserId);
          if (phone !== undefined) {
            // Repopulate in-memory cache from DB
            hashToPhone.set(channelUserId, phone);
          }
        }
        if (phone === undefined) {
          throw new Error(
            `Signal outbound: cannot resolve hash ${channelUserId.slice(0, 8)}… to phone number — no inbound message received from this user yet`,
          );
        }
        await sendOutbound(client, phone, content);
      },
    },

    messaging: {
      onMessage: (handler) => {
        messageHandler = handler;
      },
    },

    security,
  };
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export default {
  async activate(api: AionimaPluginAPI): Promise<void> {
    const channelConfig = api.getChannelConfig("signal");
    if (!channelConfig?.enabled) return;
    const config = channelConfig.config as unknown as SignalConfig;

    // v2 registration (CHN-L s173) — gateway dispatcher uses this path
    const v2Def = createSignalChannelDefV2(config);
    api.registerChannelV2?.(v2Def);

    // v0.1 legacy registration — kept until CHN-M (s174) removes @agi/channel-sdk
    const plugin = createSignalPlugin(config);
    api.registerChannel(plugin);
  },
} satisfies AionimaPlugin;
