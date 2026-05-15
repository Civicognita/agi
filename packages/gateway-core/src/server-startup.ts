/**
 * Gateway Sidecars Startup — launches channel plugins, queue consumer,
 * session sweep, and dashboard broadcaster after HTTP/WS servers are bound.
 *
 * Analogue of OpenClaw's server-startup.ts.
 * Called from server.ts step 8.
 */

import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";

import type { AionimaChannelPlugin, AionimaMessage } from "@agi/plugins";
import type { ChannelDefinition, ChannelContext, ChannelEvent } from "@agi/sdk";

import type { ChannelRegistry } from "./channel-registry.js";
import type { QueueConsumer } from "./queue-consumer.js";
import type { AgentSessionManager } from "./agent-session.js";
import type { SessionStore } from "./session-store.js";
import type { DashboardEventBroadcaster } from "./dashboard-events.js";
import type { InboundRouter } from "./inbound-router.js";
import type { ChannelWorkflowBinding, ChannelWorkflowBindingStore } from "./channel-workflow-binding-store.js";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// Minimal structural slice of PluginRegistry needed for v2 channel dispatch.
// gateway-core already depends on @agi/plugins but using a structural interface
// here keeps the coupling explicit and lets tests pass a minimal stub.
interface PluginRegistryV2Surface {
  getChannelsV2(): Array<{ channelId: string; definition: unknown }>;
}

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
  upsertPhoneHash(channel: string, hash: string, rawPhone: string): Promise<void>;
  lookupPhoneHash(channel: string, hash: string): Promise<string | undefined>;
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
  /** v2 channel registry — channels registered via api.registerChannelV2 (CHN-B s163 slice 3). */
  pluginRegistry?: PluginRegistryV2Surface;
  /** Binding store — matched against v2 channel events for MApp dispatch. CHN-F (s167) slice 2. */
  channelWorkflowBindingStore?: ChannelWorkflowBindingStore;
  /**
   * Callback invoked when one or more workflow bindings match an inbound
   * channel event. Caller (server.ts) owns the MApp executor logic so
   * server-startup stays free of executor deps. CHN-F (s167) slice 2.
   */
  onWorkflowMatch?: (bindings: ChannelWorkflowBinding[], msg: AionimaMessage, entityId: string) => void;
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
  /** Stop all v2-protocol channels. Called by server.ts teardown alongside channelRegistry.stopAll(). */
  stopV2Channels: () => Promise<void>;
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
    pluginRegistry,
    channelWorkflowBindingStore,
    onWorkflowMatch,
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
  // (b) Start legacy channels, skipping any that have a v2 registration.
  //     v2-registered channels start via the v2 block below (a2) to avoid
  //     double-connecting the underlying transport (e.g. two discord.js
  //     client.login() calls from the same token).
  // -------------------------------------------------------------------------

  const v2ChannelIds = new Set(
    pluginRegistry ? pluginRegistry.getChannelsV2().map((e) => e.channelId) : [],
  );

  // Wire error listener before start so runtime errors are caught
  channelRegistry.on("channel_error", (channelId: string, _message: string) => {
    if (v2ChannelIds.has(channelId)) return; // v2 channels manage their own restart
    const entry = channelRegistry.getChannel(channelId);
    if (entry === undefined) return;
    scheduleChannelRestart(channelId, channelRegistry, 0, log);
  });

  try {
    // Start legacy channels only (skip v2 counterparts)
    const legacyIds = channelRegistry.getChannels()
      .map((e) => e.plugin.id as string)
      .filter((id) => !v2ChannelIds.has(id));

    await Promise.allSettled(
      legacyIds.map((id) =>
        channelRegistry.startChannel(id).catch((err: unknown) => {
          log.error(`failed to start "${id}": ${err instanceof Error ? err.message : String(err)}`);
        }),
      ),
    );

    // Wire inbound router to all running legacy channels
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
    log.error(
      `unexpected error during legacy channel start: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // -------------------------------------------------------------------------
  // (a2) Start v2 channels — registered via api.registerChannelV2 (CHN-B s163)
  //
  // Each v2 entry carries an opaque `definition: unknown` at the @agi/plugins
  // boundary. Here in gateway-core (which imports both @agi/plugins AND @agi/sdk)
  // we safely cast to ChannelDefinition and drive the full ChannelProtocol
  // lifecycle. Legacy registration for the same channel is skipped above.
  // -------------------------------------------------------------------------

  const v2StopHandles = new Map<string, () => Promise<void>>();

  if (pluginRegistry) {
    for (const v2Entry of pluginRegistry.getChannelsV2()) {
      const def = v2Entry.definition as ChannelDefinition;
      const channelOpts = opts.channels.find((c) => c.id === def.id);
      const channelConfig: Record<string, unknown> = channelOpts?.config ?? {};
      const channelLog = createComponentLogger(deps.logger, `channel-v2:${def.id}`);

      const ctx: ChannelContext = {
        config: channelConfig,
        logger: {
          info: (msg, meta) => channelLog.info(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
          warn: (msg, meta) => channelLog.warn(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
          error: (msg, meta) => channelLog.error(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
        },
        // CHN-C (s164) wires real cage bindings; stubs return null until then
        cageProvider: (_roomId) => null,
        // CHN-E (s166) wires real entity resolution; stubs pending until then
        resolveEntity: async (userId) => ({
          entityId: `pending-from-${def.id}:${userId}`,
          isPending: true,
        }),
      };

      try {
        const protocol = def.createProtocol(ctx);
        const handle = await protocol.start();
        v2StopHandles.set(def.id, handle.stop);
        channelsStarted.push(def.id);

        // Bridge v2 ChannelEvent → AionimaMessage → InboundRouter
        protocol.onEvent((event: ChannelEvent) => {
          if (event.kind !== "message") return;
          const msg = event.message;
          const aionimaMsg: AionimaMessage = {
            id: msg.messageId,
            channelId: def.id as AionimaMessage["channelId"],
            channelUserId: msg.authorId,
            timestamp: msg.sentAt,
            content: { type: "text", text: msg.text },
            replyTo: msg.replyToMessageId,
            threadId: msg.threadRootMessageId,
            // CHN-B (s163) slice 6 — attachments flow via metadata since
            // MessageContent has no multi-attachment variant yet.
            metadata: {
              roomId: msg.roomId,
              mentionsBot: msg.mentionsBot,
              ...(msg.attachments !== undefined && msg.attachments.length > 0
                ? { attachments: msg.attachments }
                : {}),
            },
          };
          const preview = msg.text.slice(0, 80);
          log.info(`[v2 inbound] ${def.id}: message from ${msg.authorId} in ${msg.roomId} — "${preview}"`);
          inboundRouter.route(aionimaMsg).then((result) => {
            if (result === null) {
              log.info(`[v2 inbound] ${def.id}: handled inline`);
              return;
            }
            log.info(`[v2 inbound] ${def.id}: routed → entity=${result.entityId} queue=${result.queueMessageId}`);

            // CHN-F (s167) slice 2 — workflow binding dispatch.
            // After routing completes, check for channel-workflow bindings that
            // match this event. Caller (server.ts) owns executor logic via callback.
            if (channelWorkflowBindingStore !== undefined && onWorkflowMatch !== undefined) {
              const roomId = typeof aionimaMsg.metadata === "object" && aionimaMsg.metadata !== null
                ? (aionimaMsg.metadata as Record<string, unknown>)["roomId"] as string | undefined
                : undefined;
              const messageText = aionimaMsg.content.type === "text"
                ? (aionimaMsg.content as { type: "text"; text: string }).text
                : undefined;
              const matched = channelWorkflowBindingStore.match({
                channelId: def.id,
                roomId,
                roles: [],  // CHN-E (s166) wires entity roles; empty = role-id bindings skip for now
                messageText,
              });
              if (matched.length > 0) {
                log.info(`[workflow] ${def.id}: ${String(matched.length)} binding(s) matched (mappIds: ${matched.map((b) => b.mappId).join(", ")})`);
                onWorkflowMatch(matched, aionimaMsg, result.entityId);
              }
            }
          }).catch((err: unknown) => {
            log.error(`[v2 inbound] ${def.id}: routing error: ${err instanceof Error ? err.message : String(err)}`);
          });
        });

        log.info(`[v2] channel "${def.id}" started`);
      } catch (err) {
        log.error(`[v2] failed to start "${def.id}": ${err instanceof Error ? err.message : String(err)}`);
        channelsSkipped.push(def.id);
      }
    }
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

  const stopV2Channels = async (): Promise<void> => {
    await Promise.allSettled(
      Array.from(v2StopHandles.entries()).map(([id, stop]) =>
        stop().catch((err: unknown) => {
          log.error(`[v2] failed to stop "${id}": ${err instanceof Error ? err.message : String(err)}`);
        }),
      ),
    );
  };

  return { channelsStarted, channelsSkipped, stopV2Channels };
}
