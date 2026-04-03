/**
 * WhatsApp Business API Channel Adapter — Task #161
 *
 * AionimaChannelPlugin implementation for WhatsApp via the Cloud API
 * (or 360dialog aggregator). Webhook-based, NOT polling.
 *
 * Key design decisions:
 *   - Phone numbers are SHA-256 hashed (never stored in plaintext)
 *   - 24-hour messaging window enforced with template fallback
 *   - Webhook signature verification (HMAC-SHA256) on every POST
 *   - Labeled EXPERIMENTAL (first non-Telegram channel)
 *
 * @see config.ts for configuration options
 * @see normalizer.ts for message normalization
 * @see outbound.ts for send logic + conversation window
 * @see security.ts for HMAC verification + rate limiting
 * @see webhook.ts for HTTP handler
 */

import type {
  AionimaChannelPlugin,
  AionimaMessage,
} from "@aionima/channel-sdk";
import type { AionimaPlugin, AionimaPluginAPI } from "@aionima/plugins";

import {
  type WhatsAppConfig,
  isWhatsAppConfig,
  createConfigAdapter,
} from "./config.js";
import { WHATSAPP_CHANNEL_ID, hashPhoneNumber } from "./normalizer.js";
import {
  sendOutbound,
  createApiClient,
  ConversationWindowTracker,
} from "./outbound.js";
import { createSecurityAdapter } from "./security.js";
import { handleWebhook } from "./webhook.js";

import type { IncomingMessage, ServerResponse } from "node:http";

// Re-exports
export type { WhatsAppConfig } from "./config.js";
export { isWhatsAppConfig } from "./config.js";
export { WHATSAPP_CHANNEL_ID, hashPhoneNumber, normalizeWebhook } from "./normalizer.js";
export { splitText, ConversationWindowTracker } from "./outbound.js";
export { verifyWebhookSignature, hashPhoneForAllowlist } from "./security.js";
export { handleWebhook } from "./webhook.js";
export type {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppSendRequest,
  WhatsAppSendResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// EntityStore interface (minimal surface used for hash persistence)
// ---------------------------------------------------------------------------

/** Minimal EntityStore surface used by the WhatsApp plugin for persistence. */
export interface WhatsAppEntityStore {
  upsertPhoneHash(channel: string, hash: string, rawPhone: string): void;
  lookupPhoneHash(channel: string, hash: string): string | undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully-wired {@link AionimaChannelPlugin} for WhatsApp Business API.
 *
 * Uses webhook-based message delivery (not polling).
 * The returned plugin satisfies all required adapters from the channel-sdk.
 *
 * **EXPERIMENTAL** — First non-Telegram channel adapter.
 *
 * @param config - Validated WhatsApp configuration.
 * @param entityStore - Optional entity store for hash→phone persistence
 *   across gateway restarts. When provided, the hash→phone map is written
 *   to the database on each inbound webhook and read on outbound sends.
 * @throws {Error} If `config` fails runtime validation.
 *
 * @example
 * ```ts
 * const plugin = createWhatsAppPlugin({
 *   accessToken: process.env.WHATSAPP_TOKEN!,
 *   phoneNumberId: process.env.WHATSAPP_PHONE_ID!,
 *   verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
 *   appSecret: process.env.WHATSAPP_APP_SECRET!,
 * });
 * registry.register(plugin);
 * ```
 */
export function createWhatsAppPlugin(
  config: WhatsAppConfig,
  entityStore?: WhatsAppEntityStore,
): AionimaChannelPlugin & { webhookHandler: WhatsAppWebhookHandler } {
  if (!isWhatsAppConfig(config)) {
    throw new Error(
      "Invalid WhatsApp config: accessToken, phoneNumberId, verifyToken, and appSecret are required",
    );
  }

  const api = createApiClient(config);
  const windowTracker = new ConversationWindowTracker();
  let running = false;
  let messageHandler: ((message: AionimaMessage) => Promise<void>) | null = null;

  // Reverse map: SHA-256 hash → raw phone number.
  // Populated on each inbound webhook so outbound can resolve the recipient.
  // The DB (via entityStore) is the primary store; this map is an in-memory cache.
  const hashToPhone = new Map<string, string>();

  const security = createSecurityAdapter({
    rateLimitPerMinute: config.rateLimitPerMinute,
  });

  // The webhook handler to be mounted on the gateway HTTP server
  const webhookHandler: WhatsAppWebhookHandler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    return handleWebhook(req, res, {
      config,
      windowTracker,
      onMessages: async (messages) => {
        if (messageHandler === null) return;
        for (const msg of messages) {
          await messageHandler(msg);
        }
      },
      onRawPhone: (rawPhone: string) => {
        // Called by webhook handler with the raw phone before normalization.
        const hash = hashPhoneNumber(rawPhone);

        // Update in-memory cache
        hashToPhone.set(hash, rawPhone);

        // Persist to DB so mapping survives restarts
        if (entityStore !== undefined) {
          try {
            entityStore.upsertPhoneHash(WHATSAPP_CHANNEL_ID as string, hash, rawPhone);
          } catch (err) {
            console.warn("[whatsapp] failed to persist phone hash:", err instanceof Error ? err.message : String(err));
          }
        }
      },
    });
  };

  return {
    id: WHATSAPP_CHANNEL_ID,

    meta: {
      name: "WhatsApp",
      version: "0.1.0",
      description: "WhatsApp Business API adapter (EXPERIMENTAL)",
      author: "Civicognita",
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
        // WhatsApp is webhook-based — "starting" just sets the running flag.
        // The actual webhook endpoint must be mounted on the gateway HTTP server.
        running = true;
      },

      stop: async () => {
        running = false;
        windowTracker.cleanup();
      },

      isRunning: () => running,
    },

    outbound: {
      send: async (channelUserId: string, content) => {
        // channelUserId is the SHA-256 hash — resolve to raw phone.
        // Check in-memory cache first, then fall back to DB.
        let phone = hashToPhone.get(channelUserId);
        if (phone === undefined && entityStore !== undefined) {
          phone = entityStore.lookupPhoneHash(WHATSAPP_CHANNEL_ID as string, channelUserId);
          if (phone !== undefined) {
            // Repopulate in-memory cache from DB
            hashToPhone.set(channelUserId, phone);
          }
        }
        if (phone === undefined) {
          throw new Error(
            `WhatsApp outbound: cannot resolve hash ${channelUserId.slice(0, 8)}… to phone number — no inbound message received from this user yet`,
          );
        }
        await sendOutbound(api, phone, content, windowTracker, config);
      },
    },

    messaging: {
      onMessage: (handler) => {
        messageHandler = handler;
      },
    },

    security,

    // Additional: webhook handler for gateway to mount
    webhookHandler,
  };
}

/** Webhook handler function signature for gateway mounting. */
export type WhatsAppWebhookHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export default {
  async activate(api: AionimaPluginAPI): Promise<void> {
    const channelConfig = api.getChannelConfig("whatsapp");
    if (!channelConfig?.enabled) return;
    const plugin = createWhatsAppPlugin(
      channelConfig.config as unknown as WhatsAppConfig,
    );
    api.registerChannel(plugin);
  },
} satisfies AionimaPlugin;
