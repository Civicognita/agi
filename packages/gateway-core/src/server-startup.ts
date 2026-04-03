/**
 * Gateway Sidecars Startup — launches channel plugins, queue consumer,
 * session sweep, and dashboard broadcaster after HTTP/WS servers are bound.
 *
 * Analogue of OpenClaw's server-startup.ts.
 * Called from server.ts step 8.
 */

import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";

import type { AionimaChannelPlugin, AionimaMessage } from "@aionima/channel-sdk";

import type { ChannelRegistry } from "./channel-registry.js";
import type { QueueConsumer } from "./queue-consumer.js";
import type { AgentSessionManager } from "./agent-session.js";
import type { SessionStore } from "./session-store.js";
import type { DashboardEventBroadcaster } from "./dashboard-events.js";
import type { InboundRouter } from "./inbound-router.js";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Channel factory type
// ---------------------------------------------------------------------------

/** A plugin that optionally exposes a webhookHandler for HTTP mounting. */
type PluginWithWebhook = AionimaChannelPlugin & {
  webhookHandler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Backoff retry helpers
// ---------------------------------------------------------------------------

/** Backoff configuration for channel restart-on-failure. */
const BACKOFF_INITIAL_DELAY_MS = 5_000;
const BACKOFF_MAX_DELAY_MS = 300_000; // 5 minutes
const BACKOFF_MAX_ATTEMPTS = 10;

/**
 * Compute the exponential backoff delay with jitter for a given attempt index.
 *
 * Formula: min(initialDelay * 2^attempt, maxDelay) + jitter
 * Jitter is ±10% of the base delay, bounded to avoid negative values.
 */
function computeBackoffDelay(attempt: number): number {
  const base = Math.min(
    BACKOFF_INITIAL_DELAY_MS * Math.pow(2, attempt),
    BACKOFF_MAX_DELAY_MS,
  );
  const jitter = Math.floor(base * 0.1 * (Math.random() * 2 - 1));
  return Math.max(BACKOFF_INITIAL_DELAY_MS, base + jitter);
}

/**
 * Start a backoff-retry loop for a single channel.
 *
 * Called when a channel emits an error event or fails its initial start.
 * Schedules repeated restart attempts using exponential backoff up to
 * BACKOFF_MAX_ATTEMPTS. After max attempts, marks the channel as failed
 * and stops retrying (does not crash the gateway).
 */
function scheduleChannelRestart(
  channelId: string,
  channelRegistry: ChannelRegistry,
  attempt: number,
  log: ComponentLogger,
): void {
  if (attempt >= BACKOFF_MAX_ATTEMPTS) {
    log.error(
      `channel "${channelId}" exceeded max restart attempts (${String(BACKOFF_MAX_ATTEMPTS)}) — marking as failed`,
    );
    return;
  }

  const delayMs = computeBackoffDelay(attempt);
  const delaySec = Math.round(delayMs / 1000);

  log.warn(
    `channel "${channelId}" restart attempt ${String(attempt + 1)}/${String(BACKOFF_MAX_ATTEMPTS)} in ${String(delaySec)}s`,
  );

  setTimeout(() => {
    channelRegistry.restartChannel(channelId).then(() => {
      log.info(`channel "${channelId}" restarted successfully`);
    }).catch((err: unknown) => {
      log.error(
        `channel "${channelId}" restart attempt ${String(attempt + 1)} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Schedule next attempt
      scheduleChannelRestart(channelId, channelRegistry, attempt + 1, log);
    });
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Webhook mounting helper
// ---------------------------------------------------------------------------

/**
 * Returns true if the plugin has a webhookHandler property (type guard).
 */
function hasWebhookHandler(plugin: AionimaChannelPlugin): plugin is PluginWithWebhook {
  return typeof (plugin as PluginWithWebhook).webhookHandler === "function";
}

/**
 * Mount a channel plugin's webhook handler on the HTTP server.
 *
 * Registers a "request" listener for the path `/webhook/{channelId}`.
 * The handler is only invoked when the request URL starts with that path.
 */
function mountWebhook(
  httpServer: HttpServer,
  channelId: string,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
  log: ComponentLogger,
): void {
  const prefix = `/webhook/${channelId}`;

  httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    if (!url.startsWith(prefix)) return;

    handler(req, res).then((handled) => {
      if (!handled) {
        log.warn(`webhook handler for "${channelId}" returned false for ${url}`);
      }
    }).catch((err: unknown) => {
      log.error(
        `webhook handler for "${channelId}" threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  });

  log.info(`webhook mounted at ${prefix}`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal surface used for WhatsApp phone hash persistence. */
interface PhoneHashStore {
  upsertPhoneHash(channel: string, hash: string, rawPhone: string): void;
  lookupPhoneHash(channel: string, hash: string): string | undefined;
}

export interface GatewaySidecarsDeps {
  channelRegistry: ChannelRegistry;
  inboundRouter: InboundRouter;
  queueConsumer: QueueConsumer;
  agentSessionManager: AgentSessionManager;
  sessionStore: SessionStore;
  dashboardBroadcaster: DashboardEventBroadcaster | null;
  /** HTTP server — required for mounting webhook handlers (Story 6). */
  httpServer?: HttpServer;
  /** Entity store — passed to WhatsApp for phone hash persistence (Task 14). */
  entityStore?: PhoneHashStore;
  /** Optional logger instance. */
  logger?: Logger;
}

export interface ChannelEntry {
  id: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface GatewaySidecarsOptions {
  channels: ChannelEntry[];
  dashboardEnabled: boolean;
}

export interface GatewaySidecarsResult {
  channelsStarted: string[];
  channelsSkipped: string[];
}

// ---------------------------------------------------------------------------
// startGatewaySidecars
// ---------------------------------------------------------------------------

/**
 * Start all gateway sidecars:
 *   (a) Register enabled channel plugins into ChannelRegistry
 *   (b) Start all registered channels via registry.startAll(), with
 *       error listeners wired for exponential backoff restart-on-failure
 *   (c) Mount webhook handlers on the HTTP server for webhook-based channels
 *   (d) Start QueueConsumer polling loop
 *   (e) Start AgentSessionManager idle sweep
 *   (f) Start SessionStore reaper
 *   (g) Start DashboardEventBroadcaster if enabled
 *
 * Individual channel failures are caught and logged — one channel cannot
 * block others from starting.
 */
export async function startGatewaySidecars(
  deps: GatewaySidecarsDeps,
  opts: GatewaySidecarsOptions,
): Promise<GatewaySidecarsResult> {
  const {
    channelRegistry,
    inboundRouter,
    queueConsumer,
    agentSessionManager,
    sessionStore,
    dashboardBroadcaster,
    httpServer,
  } = deps;

  const log = createComponentLogger(deps.logger, "server-startup");
  const channelsStarted: string[] = [];
  const channelsSkipped: string[] = [];

  // -------------------------------------------------------------------------
  // (a) Channel registration is now handled by the plugin system.
  //     Channels are discovered as plugins and register themselves via
  //     api.registerChannel() during plugin activation.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // (b) Start all registered channels with restart-on-failure backoff
  //
  // startAll() already catches individual channel failures internally and
  // emits "channel_error" events. We wire an error listener to each channel
  // to trigger exponential backoff restart on runtime failures.
  // -------------------------------------------------------------------------

  // Wire error listener before startAll() so runtime errors are caught
  channelRegistry.on("channel_error", (channelId: string, _message: string) => {
    const entry = channelRegistry.getChannel(channelId);
    if (entry === undefined) return;
    // Only schedule restart if registry knows about this channel
    scheduleChannelRestart(channelId, channelRegistry, 0, log);
  });

  try {
    await channelRegistry.startAll();

    // Wire inbound router to all registered channels' messaging adapters
    for (const running of channelRegistry.getRunningChannels()) {
      const id = running.plugin.id as string;
      running.plugin.messaging.onMessage(async (message: AionimaMessage) => {
        const preview = message.content.type === "text" ? message.content.text.slice(0, 80) : `[${message.content.type}]`;
        log.info(`[inbound] ${id}: message from ${message.channelUserId} — "${preview}"`);
        try {
          const result = await inboundRouter.route(message);
          if (result === null) {
            log.info(`[inbound] ${id}: handled inline (owner command or pairing gate)`);
            return;
          }
          log.info(`[inbound] routed → entity=${result.entityId} queue=${result.queueMessageId}`);
        } catch (err) {
          log.error(`[inbound] routing error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }

    for (const running of channelRegistry.getRunningChannels()) {
      const id = running.plugin.id as string;
      channelsStarted.push(id);

      // -----------------------------------------------------------------------
      // (c) Mount webhook handlers for channels that expose webhookHandler
      // -----------------------------------------------------------------------
      if (httpServer !== undefined && hasWebhookHandler(running.plugin)) {
        mountWebhook(httpServer, id, running.plugin.webhookHandler, log);
      }
    }
  } catch (err) {
    // startAll() is designed to never throw — this catch is belt-and-suspenders
    log.error(
      `unexpected error during channelRegistry.startAll(): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // -------------------------------------------------------------------------
  // (d) Start QueueConsumer polling loop
  // -------------------------------------------------------------------------

  queueConsumer.start();

  // -------------------------------------------------------------------------
  // (e) Start AgentSessionManager idle sweep
  // -------------------------------------------------------------------------

  agentSessionManager.startSweep();

  // -------------------------------------------------------------------------
  // (f) Start SessionStore reaper
  // -------------------------------------------------------------------------

  sessionStore.startReaper();

  // -------------------------------------------------------------------------
  // (g) Start DashboardEventBroadcaster if enabled
  // -------------------------------------------------------------------------

  if (opts.dashboardEnabled && dashboardBroadcaster !== null) {
    // DashboardEventBroadcaster starts automatically on construction by
    // subscribing to wss events. No explicit start() needed.
    // The broadcaster is alive as long as the reference is held.
    log.info("dashboard event broadcaster active");
  }

  return { channelsStarted, channelsSkipped };
}
