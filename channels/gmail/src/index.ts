import type {
  AionimaChannelPlugin,
  AionimaMessage,
} from "@aionima/channel-sdk";
import type { AionimaPlugin, AionimaPluginAPI } from "@aionima/plugins";

import {
  type EmailConfig,
  isEmailConfig,
  createConfigAdapter,
} from "./config.js";
import {
  GMAIL_CHANNEL_ID,
  normalizeMessage,
  type ThreadContext,
} from "./normalizer.js";
import { sendOutbound } from "./outbound.js";
import { createSecurityAdapter } from "./security.js";
import { GmailClient } from "./gmail-client.js";

// Re-exports for consumer convenience
export type { EmailConfig } from "./config.js";
export { isEmailConfig } from "./config.js";
export {
  normalizeMessage,
  extractSenderEmail,
  buildDisplayName,
  GMAIL_CHANNEL_ID,
} from "./normalizer.js";
export { buildMimeMessage } from "./gmail-client.js";

export function createEmailPlugin(config: EmailConfig): AionimaChannelPlugin {
  if (!isEmailConfig(config)) {
    throw new Error(
      "Invalid Email config: account, clientId, clientSecret, and refreshToken are required",
    );
  }

  const client = new GmailClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
  });

  let running = false;
  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  let messageHandler: ((message: AionimaMessage) => Promise<void>) | null = null;

  // Track last historyId for incremental polling
  let lastHistoryId: string | null = null;

  // Dedup: track processed message IDs to avoid reprocessing
  const processedIds = new Set<string>();

  // Thread context map: sender email → latest ThreadContext for reply threading
  const threadContextMap = new Map<string, ThreadContext>();

  const pollingIntervalMs = config.pollingIntervalMs ?? 15_000;
  const maxAgeMinutes = config.maxAgeMinutes ?? 30;
  const label = config.label ?? "INBOX";

  async function poll(): Promise<void> {
    try {
      const result = await client.pollNewMessages(lastHistoryId, maxAgeMinutes, label);

      if (result.latestHistoryId !== null) {
        lastHistoryId = result.latestHistoryId;
      }

      if (messageHandler === null) return;

      for (const raw of result.messages) {
        // Dedup
        if (processedIds.has(raw.id)) continue;
        processedIds.add(raw.id);

        // Cap dedup set size to prevent unbounded memory growth
        if (processedIds.size > 5000) {
          const iter = processedIds.values();
          for (let i = 0; i < 1000; i++) {
            const next = iter.next();
            if (next.done) break;
            processedIds.delete(next.value);
          }
        }

        const normalized = normalizeMessage(raw, config.account);
        if (normalized === null) continue;

        const { message, threadContext } = normalized;

        // Cache thread context for outbound reply threading
        threadContextMap.set(message.channelUserId, threadContext);

        // Mark as read before dispatching to avoid re-polling
        try {
          await client.markAsRead(raw.id);
        } catch (err) {
          console.warn(
            "[email] failed to mark message as read:",
            err instanceof Error ? err.message : String(err),
          );
        }

        await messageHandler(message);
      }
    } catch (err) {
      console.warn(
        "[email] Polling error:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const security = createSecurityAdapter({
    allowedAddresses: config.allowedAddresses,
    rateLimitPerMinute: config.rateLimitPerMinute,
  });

  return {
    id: GMAIL_CHANNEL_ID,
    meta: {
      name: "Gmail",
      version: "0.1.0",
      description: "Gmail API adapter with history-based polling",
    },
    capabilities: {
      text: true,
      media: false,
      voice: false,
      reactions: false,
      threads: true,
      ephemeral: false,
    },
    config: createConfigAdapter(),
    gateway: {
      start: async () => {
        try {
          const profile = await client.healthCheck();
          console.log(`[email] Gmail API healthy — account: ${profile.email}`);
          lastHistoryId = profile.historyId;
        } catch (err) {
          console.warn(
            "[email] Gmail API unreachable at startup — polling will retry:",
            err instanceof Error ? err.message : String(err),
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
        return pollingTimer !== null;
      },
    },
    outbound: {
      send: async (channelUserId: string, content) => {
        const threadContext = threadContextMap.get(channelUserId);
        await sendOutbound(client, channelUserId, content, threadContext);
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
    const channelConfig = api.getChannelConfig("gmail");
    if (!channelConfig?.enabled) return;
    const plugin = createEmailPlugin(
      channelConfig.config as unknown as EmailConfig,
    );
    api.registerChannel(plugin);
  },
} satisfies AionimaPlugin;
