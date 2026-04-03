import { Bot } from "grammy";
import type {
  AionimaChannelPlugin,
  AionimaMessage,
} from "@aionima/channel-sdk";
import type { AionimaPlugin, AionimaPluginAPI } from "@aionima/plugins";

import {
  type TelegramConfig,
  isTelegramConfig,
  createConfigAdapter,
} from "./config.js";
import { TELEGRAM_CHANNEL_ID, normalizeMessage, buildDisplayName } from "./normalizer.js";
import { sendOutbound } from "./outbound.js";
import { createSecurityAdapter } from "./security.js";

// Re-exports for consumer convenience
export type { TelegramConfig } from "./config.js";
export { isTelegramConfig } from "./config.js";
export { normalizeMessage, buildDisplayName, TELEGRAM_CHANNEL_ID } from "./normalizer.js";
export { splitText } from "./outbound.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully-wired {@link AionimaChannelPlugin} for Telegram.
 *
 * Uses Grammy with long-polling (no webhook setup required).
 * The returned plugin satisfies all required adapters from the channel-sdk.
 *
 * @param config - Validated Telegram configuration.
 * @throws {Error} If `config` fails runtime validation.
 *
 * @example
 * ```ts
 * const plugin = createTelegramPlugin({ botToken: process.env.BOT_TOKEN! });
 * registry.register(plugin);
 * await registry.startChannel("telegram");
 * ```
 */
export function createTelegramPlugin(
  config: TelegramConfig,
): AionimaChannelPlugin {
  if (!isTelegramConfig(config)) {
    throw new Error("Invalid Telegram config: botToken is required");
  }

  const bot = new Bot(config.botToken);
  let running = false;
  let messageHandler: ((message: AionimaMessage) => Promise<void>) | null = null;

  // Register bot commands menu with Telegram
  bot.api.setMyCommands([
    { command: "start", description: "Start interacting with Aionima" },
  ]).catch((err: unknown) => {
    console.warn("[telegram] Failed to set bot commands:", err instanceof Error ? err.message : String(err));
  });

  // /start command — greet user and capture display name
  bot.command("start", async (ctx) => {
    if (messageHandler === null || ctx.message === undefined) return;
    const normalized = normalizeMessage(ctx.message);
    if (normalized === null) return;
    normalized.metadata = {
      ...normalized.metadata,
      displayName: buildDisplayName(ctx.message),
      isCommand: true,
      command: "start",
    };
    await messageHandler(normalized);
  });

  // Register Grammy message handler — delegates to the messaging adapter's
  // registered handler after normalizing the update.
  bot.on("message", async (ctx) => {
    if (messageHandler === null) return;

    const normalized = normalizeMessage(ctx.message);
    if (normalized === null) return;

    await messageHandler(normalized);
  });

  const security = createSecurityAdapter({
    allowedChatIds: config.allowedChatIds,
    rateLimitPerMinute: config.rateLimitPerMinute,
  });

  return {
    id: TELEGRAM_CHANNEL_ID,

    meta: {
      name: "Telegram",
      version: "0.1.0",
      description: "Grammy-based Telegram adapter with long-polling",
    },

    capabilities: {
      text: true,
      media: true,
      voice: true,
      reactions: false,
      threads: true,
      ephemeral: false,
    },

    config: createConfigAdapter(),

    gateway: {
      start: async () => {
        // bot.start() returns a Promise that resolves when the bot stops.
        // Fire-and-forget — polling runs in the background.
        void bot.start({
          drop_pending_updates: true,
          timeout: config.pollingTimeout ?? 30,
          onStart: () => {
            running = true;
          },
        });
        // Set running immediately — onStart fires asynchronously
        running = true;
      },

      stop: async () => {
        await bot.stop();
        running = false;
      },

      isRunning: () => running,
    },

    outbound: {
      send: async (channelUserId: string, content) => {
        await sendOutbound(bot.api, channelUserId, content);
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
    const channelConfig = api.getChannelConfig("telegram");
    if (!channelConfig?.enabled) return;
    const plugin = createTelegramPlugin(
      channelConfig.config as unknown as TelegramConfig,
    );
    api.registerChannel(plugin);
  },
} satisfies AionimaPlugin;
