/**
 * Gateway Server Factory — main entry point for aionima gateway startup.
 *
 * Implements the 9-step boot sequence:
 *   1. Config validation and merge
 *   2. Auth bootstrap
 *   3. State machine initialization
 *   4. Runtime state creation (HTTP + WS servers)
 *   5. Core services initialization
 *   6. HTTP route mounting (done inside createGatewayRuntimeState)
 *   7. WebSocket handler attachment
 *   8. Sidecars startup (channels, queue, sweep, dashboard)
 *   9. Return GatewayServer handle with idempotent close()
 *
 * Analogue of OpenClaw's server.impl.ts.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { ulid } from "ulid";
import { dispatchJobsDir } from "./dispatch-paths.js";
import { resolveMarketplaceSource } from "./dev-mode-sources.js";

/**
 * Read the AGI version from package.json at the configured deploy root,
 * with graceful fallback. Used by `/health` so the dashboard can force-
 * reload stale tabs after an upgrade.
 */
function resolveAgiVersion(selfRepoPath: string | undefined): string {
  const candidates = [
    selfRepoPath ? join(selfRepoPath, "package.json") : null,
    join(process.cwd(), "package.json"),
  ].filter((p): p is string => p !== null);
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf-8");
      const pkg = JSON.parse(raw) as { version?: string };
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
      /* try next */
    }
  }
  return "unknown";
}
import { EntityStore, MessageQueue, CommsLog, NotificationStore, IncidentStore, VendorStore, SessionStore as ComplianceSessionStore, ConsentStore, UsageStore } from "@agi/entity-model";
import type { Entity } from "@agi/entity-model";
import { createDbClient } from "@agi/db-schema/client";
import { BackupManager } from "./backup-manager.js";
import { registerComplianceRoutes } from "./compliance-api.js";
import { registerSecurityRoutes } from "./security-api.js";
import { registerProvidersRoutes } from "./providers-api.js";
import { registerAdminRoutes } from "./admin-api.js";
import { ScanProviderRegistry, ScanStore, ScanRunner, sastScanner, scaScanner, secretsScanner, configScanner } from "@agi/security";
import { COAChainLogger } from "@agi/coa-chain";
import { PairingStore } from "./pairing-store.js";
import type { AionimaMessage } from "@agi/channel-sdk";
import { createLogger, createComponentLogger } from "./logger.js";
import type { Logger, LogEntry } from "./logger.js";
import { CpuPowerSampler, GpuPowerSampler } from "./system-power.js";
import { CostLedgerWriter } from "./cost-ledger-writer.js";
import { CostLedgerReader } from "./cost-ledger-reader.js";

import type { AionimaConfig, ConfigReloadEvent } from "@agi/config";
import { ConfigWatcher } from "@agi/config";

import { SecretsManager } from "./secrets.js";
import {
  readAndConsumeShutdownMarker,
  writeShutdownMarker,
  buildShutdownMarker,
  ensureExternals,
  reconcileProjects,
  reconcileModels,
} from "./boot-recovery.js";
import { safemodeState } from "./safemode-state.js";
import { LocalModelRuntime, DEFAULT_LOCAL_MODEL_ID } from "./local-model-runtime.js";
import { AionMicroManager } from "./aion-micro-manager.js";
import { runInvestigator } from "./safemode-investigator.js";
import { GatewayAuth } from "./auth.js";
import { GatewayStateMachine } from "./state-machine.js";
import type { StateTransition } from "./state-machine.js";
import type { WSMessage } from "./ws-server.js";
import { InboundRouter } from "./inbound-router.js";
import { OutboundDispatcher } from "./outbound-dispatcher.js";
import { QueueConsumer } from "./queue-consumer.js";
import { AgentSessionManager } from "./agent-session.js";
import { SessionStore } from "./session-store.js";
import { createAgentRouter, AgentRouter, setPluginProviderRegistry, setModelAgentBridge } from "./llm/index.js";
import type { LLMProvider } from "./llm/index.js";
import { RateLimiter } from "./rate-limiter.js";
import { ToolRegistry } from "./tool-registry.js";
import { AgentInvoker } from "./agent-invoker.js";
import { ChatEventBuffer } from "./chat-event-buffer.js";
import { registerAllTools, registerAgentTools } from "./tools/index.js";
import { SkillRegistry } from "@agi/skills";
import { CompositeMemoryAdapter } from "@agi/memory";
import {
  VoicePipeline,
  WhisperSTTProvider,
  LocalSTTProvider,
  EdgeTTSProvider,
  LocalTTSProvider,
} from "@agi/voice";
import type { CanvasDocument } from "./canvas-types.js";
import { ChannelRegistry } from "./channel-registry.js";
import { DashboardApi } from "./dashboard-api.js";
import { DashboardQueries } from "./dashboard-queries.js";
import { DashboardEventBroadcaster } from "./dashboard-events.js";
import { createGatewayRuntimeState } from "./server-runtime-state.js";
import { startGatewaySidecars } from "./server-startup.js";
import { UserContextStore } from "./user-context-store.js";
import { HeartbeatScheduler } from "./heartbeat.js";
import { PrimeLoader } from "./prime-loader.js";
import { resolvePrimeDir, resolveIdDir } from "./resolve-paths.js";
import { checkProtocolCompatibility } from "./protocol-check.js";
import { PlanStore } from "./plan-store.js";
import { ChatPersistence } from "./chat-persistence.js";
import type { PersistedChatSession } from "./chat-persistence.js";
import { ImageBlobStore } from "./image-blob-store.js";
import { WorkerPromptLoader } from "./worker-prompt-loader.js";
import { ChatGarbageCollector } from "./chat-garbage-collector.js";
import { buildTynnSyncPrompt } from "./plan-tynn-mapper.js";
import { projectConfigPath } from "./project-config-path.js";
import { HostingManager } from "./hosting-manager.js";
import { ProjectConfigManager } from "./project-config-manager.js";
import { SystemConfigService } from "./system-config-service.js";
import { createProjectTypeRegistry } from "./project-types.js";
import { TerminalManager } from "./terminal-manager.js";
import { discoverPlugins, getDefaultSearchPaths, loadPlugins, tryLoadManifest, PluginRegistry, HookBus } from "@agi/plugins";
import { ServiceManager } from "./service-manager.js";
import { bridgePluginCapabilities, unbridgePluginCapabilities } from "./plugin-bridges.js";
import { ScheduledTaskManager } from "./scheduled-task-manager.js";
import { MarketplaceManager } from "@agi/marketplace";
import { MarketplaceStore } from "@agi/marketplace";
import { FederationNode, generateNodeKeypair } from "./federation-node.js";
import { FederationRouter } from "./federation-router.js";
import { FederationPeerStore } from "./federation-peer-store.js";
import { IdentityProvider } from "./identity-provider.js";
import { OAuthHandler } from "./oauth-handler.js";
import { VisitorAuthManager } from "./visitor-auth.js";
import { StackRegistry } from "./stack-registry.js";
import { SharedContainerManager } from "./shared-container-manager.js";
import { WorkerRuntime } from "./worker-runtime.js";
import { ReportsStore } from "./reports-store.js";
import { registerReportsApi } from "./reports-api.js";
import { registerWorkerApi } from "./worker-api.js";
import { registerUsageRoutes } from "./usage-api.js";
import { appendUpgradeLog } from "./upgrade-log.js";
import { EventEmitter } from "node:events";
import { HardwareProfiler } from "./machine/hardware-profiler.js";
import {
  HfHubClient,
  ModelStore,
  DatasetStore,
  ModelContainerManager,
  CapabilityResolver,
  InferenceGateway,
  ModelAgentBridge,
  KnownModelsRegistry,
  CustomContainerBuilder,
  cleanupHubOrphans,
} from "@agi/model-runtime";
import type { ModelRuntimeEventEmitter } from "@agi/model-runtime";
import { registerHfRoutes } from "./hf-api.js";
import { registerLemonadeRoutes } from "./lemonade-api.js";
import { FineTuneManager } from "./finetune-manager.js";

// ---------------------------------------------------------------------------
// LLM-backed next-step suggestion generator
// ---------------------------------------------------------------------------

let _nextStepsPrompt: string | null = null;

function loadNextStepsPrompt(): string {
  if (_nextStepsPrompt !== null) return _nextStepsPrompt;
  try {
    _nextStepsPrompt = readFileSync(
      resolvePath(process.cwd(), "prompts/next-steps.md"),
      "utf-8",
    );
  } catch {
    _nextStepsPrompt = "Generate 3-4 concise follow-up suggestions as a JSON array of strings.";
  }
  return _nextStepsPrompt;
}

async function generateNextSteps(
  userMessage: string,
  responseText: string,
  llm: LLMProvider,
): Promise<string[]> {
  try {
    const prompt = loadNextStepsPrompt();
    const combined = `User message: ${userMessage}\n\nAgent response: ${responseText}`;
    const raw = await llm.summarize(combined, prompt);

    // Extract JSON array from response (handle possible markdown fences)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .slice(0, 4);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GatewayServerOptions {
  /** Override config.gateway.host */
  host?: string;
  /** Override config.gateway.port */
  port?: number;
  /** Path to config file — enables hot-reload when provided. */
  configPath?: string;
  /** Directory containing built dashboard static files (served by the gateway). */
  staticDir?: string;
}

export interface GatewayServer {
  /** Gracefully shut down all sidecars, servers, and database. Idempotent. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// startGatewayServer
// ---------------------------------------------------------------------------

/**
 * Start the aionima gateway with a validated config.
 *
 * @param config - Validated AionimaConfig (already parsed by AionimaConfigSchema)
 * @param opts - Optional overrides for host/port (from CLI flags)
 * @returns A handle with a single `close()` method for graceful shutdown
 */
export async function startGatewayServer(
  config: AionimaConfig,
  opts?: GatewayServerOptions,
): Promise<GatewayServer> {

  // -------------------------------------------------------------------------
  // Step 1: Config merge — apply CLI overrides
  // -------------------------------------------------------------------------

  const gw = config.gateway ?? { host: "127.0.0.1", port: 3100, state: "OFFLINE" as const };
  const host = opts?.host ?? gw.host;
  const port = opts?.port ?? gw.port;

  // -------------------------------------------------------------------------
  // Step 1b: Logger initialization (before any logging)
  // -------------------------------------------------------------------------

  const logger: Logger = createLogger(config.logging);
  const log = createComponentLogger(logger, "server");

  // -------------------------------------------------------------------------
  // Step 1b2: Boot-recovery — detect crash vs graceful shutdown
  //
  // Read (and delete) the shutdown marker written by the previous close().
  // Presence of a marker = last exit was graceful → reconcile saved state.
  // Absence = crash → enter safemode (dashboard callout + investigator).
  // External deps (ID Postgres, agi-id.service) are started either way
  // because AGI's DBs live in them.
  // -------------------------------------------------------------------------

  const bootLog = createComponentLogger(logger, "boot-recovery");
  const shutdownMarker = readAndConsumeShutdownMarker();
  const isSafemodeBoot = shutdownMarker === null;

  if (isSafemodeBoot) {
    bootLog.warn("no shutdown marker — previous exit was UNGRACEFUL. Entering SAFEMODE.");
    safemodeState.enter("crash_detected");
  } else {
    bootLog.info(
      `graceful shutdown marker consumed (reason=${shutdownMarker.reason}, shutdownAt=${shutdownMarker.shutdownAt})`,
    );
  }

  // Always ensure external deps (Postgres + ID service) are up — AGI needs them
  // even in safemode for its own DB pool.
  try {
    const externalsReport = await ensureExternals(bootLog);
    bootLog.info(
      `externals: postgres=${externalsReport.postgres.action}(${externalsReport.postgres.state}) idService=${externalsReport.idService.action}(${externalsReport.idService.state}) pgReady=${String(externalsReport.postgresReady)}`,
    );
  } catch (err) {
    bootLog.error(
      `ensureExternals threw (continuing boot): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // On clean boot, also restart project + model containers that were running
  // before. Must happen BEFORE HostingManager.initialize() and BEFORE
  // ModelContainerManager construction — both query podman and only pick up
  // containers currently in "running" state.
  if (!isSafemodeBoot && shutdownMarker !== null) {
    try {
      const projReport = reconcileProjects(shutdownMarker.projects, bootLog);
      bootLog.info(
        `reconcile projects: started=${String(projReport.started)} skipped=${String(projReport.skipped)} failed=${String(projReport.failed)}`,
      );
    } catch (err) {
      bootLog.error(
        `reconcileProjects threw (continuing boot): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const modelReport = reconcileModels(shutdownMarker.models, bootLog);
      bootLog.info(
        `reconcile models: started=${String(modelReport.started)} skipped=${String(modelReport.skipped)} failed=${String(modelReport.failed)}`,
      );
    } catch (err) {
      bootLog.error(
        `reconcileModels threw (continuing boot): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 1c: Secrets — load TPM2-sealed credentials into process.env
  // -------------------------------------------------------------------------

  const secrets = new SecretsManager();
  await secrets.initialize();
  secrets.loadIntoEnv();
  log.info(`Secrets: ${String(secrets.listSecrets().length)} credential(s) on disk, CREDENTIALS_DIRECTORY ${process.env["CREDENTIALS_DIRECTORY"] ? "active" : "not set"}`);

  // -------------------------------------------------------------------------
  // Step 2: Auth bootstrap
  // -------------------------------------------------------------------------

  const auth = new GatewayAuth({
    tokens: config.auth?.tokens ?? [],
    password: config.auth?.password,
    maxAttemptsPerWindow: config.auth?.maxAttemptsPerWindow ?? 10,
    rateLimitWindowMs: config.auth?.rateLimitWindowMs ?? 60000,
    lockoutDurationMs: config.auth?.lockoutDurationMs ?? 300000,
    maxBodyBytes: config.auth?.maxBodyBytes ?? 2097152,
    exemptIps: ["127.0.0.1", "::1", "::ffff:127.0.0.1"],
  });

  // Warn on no tokens in non-loopback mode
  if ((config.auth?.tokens ?? []).length === 0) {
    log.warn(
      "No auth tokens configured. Gateway accessible without authentication from non-loopback IPs.",
    );
  }

  // -------------------------------------------------------------------------
  // Step 3: State machine initialization
  // -------------------------------------------------------------------------

  const stateMachine = new GatewayStateMachine(gw.state);

  stateMachine.on("state_change", (transition: StateTransition) => {
    log.info(`state transition: ${transition.from} → ${transition.to} at ${transition.timestamp}`);
  });

  // -------------------------------------------------------------------------
  // Step 4: Core data layer — open database, create EntityStore + MessageQueue
  //
  // These are shared across InboundRouter, OutboundDispatcher, DashboardQueries.
  // -------------------------------------------------------------------------

  const { db, pool: dbPool } = createDbClient();
  const entityStore = new EntityStore(db);
  const messageQueue = new MessageQueue(db);
  const coaLogger = new COAChainLogger(db);
  const commsLog = new CommsLog(db);
  const notificationStore = new NotificationStore(db);
  const incidentStore = new IncidentStore(db);
  const vendorStore = new VendorStore(db);
  const complianceSessionStore = new ComplianceSessionStore(db);
  // ConsentStore instantiated — available for future consent API routes
  void new ConsentStore(db);
  const usageStore = new UsageStore(db);

  // Seed vendors from configured providers (async — fire-and-forget at boot)
  void vendorStore.seedFromConfig(config as Record<string, unknown>);

  // Start backup manager if enabled
  let backupManager: BackupManager | undefined;
  if (config.backup?.enabled !== false) {
    const backupDir = (config.backup?.dir ?? join(homedir(), ".agi", "backups")).replace(/^~/, homedir());
    const databaseUrl = process.env.DATABASE_URL ?? "postgres://agi:aionima@localhost:5432/agi_data";
    backupManager = new BackupManager({
      backupDir,
      databaseUrl,
      retentionDays: config.backup?.retentionDays ?? 30,
      logger,
    });
    backupManager.startSchedule();
    log.info(`backups: scheduled to ${backupDir} (${String(config.backup?.retentionDays ?? 30)}d retention)`);
  }

  // Note: VerificationManager is available via `new VerificationManager(db)` if needed
  // for federation use cases. Not instantiated at boot since local verification
  // is handled by the owner + pairing model.

  // -------------------------------------------------------------------------
  // Step 4b: PRIME knowledge corpus indexing
  // -------------------------------------------------------------------------

  const primeDir = resolvePrimeDir(config);
  const idDir = resolveIdDir(config);
  const primeLoader = new PrimeLoader(primeDir);
  const primeEntryCount = primeLoader.index();
  log.info(`PRIME corpus indexed: ${String(primeEntryCount)} entries from ${primeDir}`);

  // Protocol compatibility check — selfRepo is the AGI repo path (used by upgrade system)
  const agiRoot = config.workspace?.selfRepo ?? config.workspace?.root ?? process.cwd();
  const protocolResult = checkProtocolCompatibility(agiRoot, primeDir, idDir);
  if (!protocolResult.compatible) {
    for (const err of protocolResult.errors) {
      log.warn(`Protocol compatibility: ${err}`);
    }
    log.warn("Running in degraded mode — protocol version mismatch detected");
  }

  const devMode = config.dev?.enabled ?? config.agent?.devMode ?? false;

  // -------------------------------------------------------------------------
  // Step 4c: Owner identity bootstrap
  // -------------------------------------------------------------------------

  const ownerConfig = config.owner;
  let ownerEntityId: string | undefined;

  if (ownerConfig !== undefined) {
    const ownerChannels = ownerConfig.channels;
    const hasChannels = Object.values(ownerChannels).some((v) => v !== undefined);

    if (hasChannels) {
      // First pass: find an existing entity from ANY configured channel.
      // This prevents creating a duplicate when a new channel ID is added
      // alongside one that already has an entity (e.g. adding Discord
      // when Telegram entity #E0 already exists).
      const channelEntries = Object.entries(ownerChannels).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      );

      let ownerEntity: Entity | undefined;

      for (const [channel, channelUserId] of channelEntries) {
        const existing = await entityStore.getEntityByChannel(channel, channelUserId);
        if (existing !== null) {
          ownerEntity = existing;
          break;
        }
      }

      // If no existing entity found, create one from the first channel
      if (ownerEntity === undefined) {
        const [firstChannel, firstUserId] = channelEntries[0]!;
        ownerEntity = await entityStore.resolveOrCreate(firstChannel, firstUserId, ownerConfig.displayName);
      }

      // Link all channels to the resolved entity
      for (const [channel, channelUserId] of channelEntries) {
        await entityStore.upsertChannelAccount({
          entityId: ownerEntity.id,
          channel,
          channelUserId,
        });
      }

      // Ensure the owner entity is sealed (full access)
      if (ownerEntity.verificationTier !== "sealed") {
        await entityStore.updateEntity(ownerEntity.id, { verificationTier: "sealed" });
      }
      // Update display name if it was "Unknown"
      if (ownerEntity.displayName === "Unknown") {
        await entityStore.updateEntity(ownerEntity.id, { displayName: ownerConfig.displayName });
      }
      ownerEntityId = ownerEntity.id;
      log.info(`owner entity resolved: ${ownerEntity.coaAlias} (${ownerEntity.displayName}) — sealed`);
    } else {
      log.warn("owner.channels is empty — owner recognition disabled");
    }
  }

  // Pairing store — manages DM access grants for non-owner users
  const pairingStore = new PairingStore({
    persistPath: "./data/paired.json",
    logger,
  });

  // -------------------------------------------------------------------------
  // Step 5a: Core routing services
  // -------------------------------------------------------------------------

  const resourceId = config.agent?.resourceId ?? "$A0";
  const nodeId = config.agent?.nodeId ?? "@A0";

  const channelRegistry = new ChannelRegistry(logger);

  // -------------------------------------------------------------------------
  // Step 5a-voice: Voice pipeline (optional, STATE-gated)
  // -------------------------------------------------------------------------

  let voicePipeline: VoicePipeline | undefined;

  if (config.voice?.enabled) {
    const voiceCfg = config.voice;
    const localModelDir = "./data/voice-models";

    const onlineSTT = voiceCfg.sttProvider === "local"
      ? new LocalSTTProvider({ modelDir: localModelDir })
      : new WhisperSTTProvider({
          apiKey: voiceCfg.whisperApiKey,
          model: voiceCfg.whisperModel,
        });

    const offlineSTT = new LocalSTTProvider({ modelDir: localModelDir });

    const onlineTTS = voiceCfg.ttsProvider === "local"
      ? new LocalTTSProvider({ modelDir: localModelDir })
      : new EdgeTTSProvider();

    const offlineTTS = new LocalTTSProvider({ modelDir: localModelDir });

    voicePipeline = new VoicePipeline({
      onlineSTT,
      offlineSTT,
      onlineTTS,
      offlineTTS,
    });

    log.info(
      `voice pipeline initialized (stt=${voiceCfg.sttProvider}, tts=${voiceCfg.ttsProvider})`,
    );
  }

  // Outbound dispatcher — constructed before inbound router so we can create
  // the outbound sender closure for pairing notifications.
  const outboundDispatcher = new OutboundDispatcher({
    getChannelAdapter: (channelId: string) => channelRegistry.getChannel(channelId)?.plugin.outbound,
    coaLogger,
    // Look up the entity's COA alias for each outbound dispatch. Falls back to
    // "#E?" on miss — entity might have been deleted between message enqueue
    // and dispatch, which is rare but not pathological.
    resolveCoaAlias: async (entityId: string) => {
      const entity = await entityStore.getEntity(entityId);
      return entity?.coaAlias ?? "#E?";
    },
    resourceId,
    nodeId,
    voicePipeline,
    getGatewayState: () => stateMachine.getState(),
    logger,
  });

  // Inbound router — created after outbound so we can wire the sender for pairing.
  const inboundRouter = new InboundRouter({
    entityStore,
    messageQueue,
    coaLogger,
    resourceId,
    nodeId,
    voicePipeline,
    getGatewayState: () => stateMachine.getState(),
    ownerConfig,
    pairingStore,
    ownerEntityId,
    commsLog,
    logger,
    outboundSender: async (channelId, channelUserId, content) => {
      await outboundDispatcher.dispatch({
        channelId,
        channelUserId,
        entityId: ownerEntityId ?? "system",
        content,
      });
    },
  });

  // -------------------------------------------------------------------------
  // Step 5b: Agent pipeline services
  // -------------------------------------------------------------------------

  // createAgentRouter may fail here for plugin-contributed types (e.g.
  // "claude-max") because plugins haven't loaded yet. Defer to a stub
  // provider that throws on first use; the post-plugin boot block below
  // replaces it with the real provider once plugins register their factories.
  let llmProvider: ReturnType<typeof createAgentRouter>;
  try {
    llmProvider = createAgentRouter(config, logger);
  } catch {
    const providerType = (config.agent as { provider?: string } | undefined)?.provider ?? "unknown";
    log.info(`LLM provider "${providerType}" deferred — will resolve after plugins load`);
    llmProvider = {
      async invoke() { throw new Error(`LLM provider "${providerType}" not yet initialized — waiting for plugins`); },
      async continueWithToolResults() { throw new Error(`LLM provider "${providerType}" not yet initialized`); },
      async summarize() { throw new Error(`LLM provider "${providerType}" not yet initialized`); },
    };
  }
  const getLLMProvider = () => llmProvider;

  /**
   * Wire the onProviderError callback on an AgentRouter instance.
   * Must be called whenever llmProvider is (re)created so billing/auth errors
   * are forwarded to the dashboard broadcaster as real-time notifications.
   */
  function wireProviderErrorCallback(provider: ReturnType<typeof createAgentRouter>): void {
    if (provider instanceof AgentRouter) {
      provider.onProviderError = (error) => {
        dashboardBroadcasterRef?.emitNotification({
          id: `provider-error-${Date.now()}`,
          type: error.type === "billing" ? "warning" : "error",
          title: `Provider ${error.type === "billing" ? "billing error" : "auth error"}: ${error.provider}`,
          body: error.message,
          metadata: { provider: error.provider, model: error.model, errorType: error.type },
          createdAt: new Date().toISOString(),
        });
      };
    }
  }

  wireProviderErrorCallback(llmProvider);

  // s111 t424 — Cost ledger writer + power sampler thunks. Server.ts owns
  // the writer (single drizzle client) + dedicated sampler instances (the
  // server-runtime-state.ts samplers serve /api/system/stats and have their
  // own delta state; per-instance state means independent readings for each
  // consumer, both correct within their own time windows). The wiring
  // assigns public optional fields after construction — same pattern as
  // wireProviderErrorCallback above. When the AgentRouter is replaced by
  // post-plugin re-creation (line 1399 / 4005), wireCostLedger() must be
  // called again to re-attach.
  const costLedgerWriter = new CostLedgerWriter(db, createComponentLogger(logger, "cost-ledger"));
  const costLedgerReader = new CostLedgerReader(db);
  const costCpuSampler = new CpuPowerSampler();
  costCpuSampler.sample(); // seed; first reading needs a baseline for delta
  const costGpuSampler = new GpuPowerSampler();

  function wireCostLedger(provider: ReturnType<typeof createAgentRouter>): void {
    if (provider instanceof AgentRouter) {
      provider.costLedgerWriter = costLedgerWriter;
      provider.sampleCpuWatts = () => costCpuSampler.sample();
      provider.sampleGpuWatts = () => costGpuSampler.sample();
    }
  }
  wireCostLedger(llmProvider);

  const agentSessionManager = new AgentSessionManager({
    contextWindowTokens: config.sessions?.contextWindowTokens ?? 200000,
    idleTimeoutMs: config.sessions?.idleTimeoutMs ?? 86400000,
  });

  const sessionStore = new SessionStore({
    maxSessions: config.sessions?.maxSessions ?? 5000,
    idleTtlMs: config.sessions?.idleTimeoutMs ?? 86400000,
  });

  const rateLimiter = new RateLimiter();
  const toolRegistry = new ToolRegistry();
  toolRegistry.setCOALogger(coaLogger);

  // Chat session context — maps sessionId → project path / context string.
  // Populated by chat:open, consumed by plan:approve to derive projectPath.
  const chatSessionContexts = new Map<string, string>();

  // User context store — per-entity relationship context (USER.md files)
  // Constructed before registerAllTools so it can be passed into tool config.
  const userContextDir = config.persona?.soulPath
    ? dirname(config.persona.soulPath)
    : "./data/persona";
  const userContextStore = new UserContextStore(userContextDir);

  // Register all built-in tools (dev tools, git tools, canvas)
  // workspaceRoot = "/" gives Aionima full machine access (no confinement).
  const workspaceRoot = config.workspace?.root ?? "/";
  const projectPaths = config.workspace?.projects ?? [];

  // Chat persistence — file-based storage in ~/.agi/chat-history/
  const chatPersistence = new ChatPersistence();

  // Image blob store — file-backed storage for chat images at ~/.agi/chat-images/
  const imageBlobStore = new ImageBlobStore();

  // In-flight session data for persistence — maps sessionId → PersistedChatSession
  const chatSessionData = new Map<string, PersistedChatSession>();
  const canvasDocuments: CanvasDocument[] = [];
  /**
   * Tracks which chat session dispatched each Taskmaster job, so worker
   * completion / handoff events can inject a synthetic user turn back into
   * the originating session via AgentInvoker.injectMessage. Populated in
   * the taskmaster_dispatch onJobCreated callback, consumed in the runtime:event
   * handler below registerAllTools.
   */
  const jobOriginBySessionKey = new Map<
    string,
    {
      sessionKey?: string;
      chatSessionId?: string;
      projectPath: string;
      planRef?: { planId: string; stepId: string };
    }
  >();
  // Late-bound worker runtime ref — populated after workerRuntime is created below.
  // The onJobCreated callback is only invoked during agent tool execution (after boot),
  // so workerRuntimeRef.current is always set by the time it is first called.
  const workerRuntimeRef: { current: WorkerRuntime | null } = { current: null };
  // Late-bound refs for project tool — populated after hosting/stack/mapp managers boot.
  const hostingManagerRef: { current: unknown | null } = { current: null };
  const stackRegistryRef: { current: unknown | null } = { current: null };
  const mappRegistryRef: { current: unknown | null } = { current: null };
  const taskmasterOrchestratorRef: { current: import("./taskmaster-orchestrator.js").TaskmasterOrchestrator | null } = { current: null };
  const pluginRegistryRef: { current: { getWorkers(): Array<{ pluginId: string; worker: { domain: string; role: string; name: string; description: string; modelTier?: string } }> } | null } = { current: null };

  // Config services — created early (no heavy dependencies) so tools can use them.
  const projectConfigManager = new ProjectConfigManager({ logger });
  const systemConfigService = opts?.configPath
    ? new SystemConfigService({ configPath: opts.configPath, logger })
    : null;

  const toolCount = registerAllTools(toolRegistry, {
    workspaceRoot,
    resourceEntityId: resourceId,
    onCanvasEmit: async (doc) => {
      canvasDocuments.push(doc);
      log.info(`canvas document emitted: ${doc.id} "${doc.title}" (${String(doc.sections.length)} sections)`);
    },
    userContextStore,
    primeLoader,
    projectDirs: projectPaths,
    projectConfigManager,
    imageBlobStore,
    hostingManagerRef,
    stackRegistryRef,
    mappRegistryRef,
    onJobCreated: (args) => {
      const { jobId, coaReqId, projectPath, sessionKey, chatSessionId, planRef } = args;
      // Remember which chat session dispatched this job so the runtime:event
      // handler below can inject worker reports back into Aion's next turn.
      jobOriginBySessionKey.set(jobId, { sessionKey, chatSessionId, projectPath, planRef });
      // Mark the linked plan step as running the moment we accept the job so
      // the Plans drawer shows progress immediately, not only on completion.
      if (planRef !== undefined) {
        try {
          planStore.update(projectPath, planRef.planId, {
            stepUpdates: [{ id: planRef.stepId, status: "running" }],
          });
        } catch (err) {
          log.warn(`plan step mark-running failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const projectContext = projectPath.length > 0
        ? { path: projectPath, name: projectPath.split("/").filter(Boolean).pop() ?? projectPath }
        : undefined;
      // Orchestrator decomposes the work into worker phases, then runtime
      // executes them sequentially. If orchestrator isn't available or fails,
      // fall back to single-phase execution.
      const dispatchFile = join(dispatchJobsDir(projectPath), `${jobId}.json`);
      void (async () => {
        let phases: import("./taskmaster-orchestrator.js").WorkPhase[] | undefined;
        if (taskmasterOrchestratorRef.current) {
          try {
            const dispatchData = JSON.parse(readFileSync(dispatchFile, "utf-8")) as { description: string };
            const workers = pluginRegistryRef.current
              ? pluginRegistryRef.current.getWorkers().map((w) => ({
                  domain: w.worker.domain,
                  role: w.worker.role,
                  name: w.worker.name,
                  description: w.worker.description,
                  modelTier: w.worker.modelTier,
                }))
              : [];
            if (workers.length > 0) {
              phases = await taskmasterOrchestratorRef.current.decompose(
                dispatchData.description, workers, coaReqId,
              );
              log.info(`[taskmaster] decomposed "${dispatchData.description.slice(0, 60)}" into ${String(phases.length)} phase(s): ${phases.map((p) => `${p.domain}.${p.role}`).join(" → ")}`);
            }
          } catch (err) {
            log.warn(`[taskmaster] orchestrator failed, falling back to single-phase: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        await workerRuntimeRef.current?.executeJob(jobId, coaReqId, projectContext, phases);
      })().catch((err: unknown) => {
        log.error(`workerRuntime.executeJob error: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    onHandoff: (args) => {
      // Re-emit as a runtime event so the dashboardBroadcaster routing
      // (server.ts:3055-ish) surfaces the handoff to Work Queue + chat.
      workerRuntimeRef.current?.emit("runtime:event", {
        type: "worker_handoff",
        jobId: args.jobId,
        question: args.question,
        projectPath: args.projectPath,
        coaReqId: args.coaReqId,
      });
    },
    onCancel: (args) => {
      // Flip state to failed + drop from active jobs + emit job_failed so
      // Work Queue + chat injection see it uniformly with other terminals.
      workerRuntimeRef.current?.cancelJob(args.jobId, args.reason);
      jobOriginBySessionKey.delete(args.jobId);
    },
  });
  log.info(`registered ${String(toolCount)} tools`);

  // Skills discovery — scan .skill.md files from configured directories
  const skillsDir = config.skills?.directory ?? "./skills";
  const skillRegistry = new SkillRegistry({
    skillDirs: [skillsDir],
    watchForChanges: config.skills?.watchForChanges ?? false,
  });
  const skillDiscovery = skillRegistry.discover();
  log.info(`loaded ${String(skillDiscovery.loaded)} skills from ${skillsDir}`);
  if (skillDiscovery.errors.length > 0) {
    for (const err of skillDiscovery.errors) {
      log.warn(`skill error in ${err.file}: ${err.error}`);
    }
  }
  if (config.skills?.watchForChanges) {
    skillRegistry.startWatching();
  }

  // Memory adapter — composite (file + optional Cognee)
  const memoryDir = config.memory?.directory ?? "./data/memory";
  const memoryAdapter = new CompositeMemoryAdapter({
    getState: () => stateMachine.getState(),
    localMemDir: memoryDir,
  });
  log.info(`memory adapter initialized (dir: ${memoryDir})`);

  const agentInvoker = new AgentInvoker({
    stateMachine,
    apiClient: getLLMProvider,
    sessionManager: agentSessionManager,
    toolRegistry,
    rateLimiter,
    coaLogger,
    resourceId,
    nodeId,
    memoryAdapter,
    skillRegistry,
    userContextStore,
    primeLoader,
    workspaceRoot,
    projectPaths,
    ownerConfig: ownerConfig !== undefined ? {
      displayName: ownerConfig.displayName,
      channels: ownerConfig.channels as Record<string, string | undefined>,
    } : undefined,
    logger,
    imageBlobStore,
    getMaxToolLoops: () => {
      // Read from live config so hot-reload takes effect per turn.
      const snap = systemConfigService?.read() ?? config;
      const gw = (snap as { gateway?: { maxToolLoops?: number } }).gateway;
      return gw?.maxToolLoops ?? 0;
    },
    getCostMode: () => {
      const snap = systemConfigService?.read() ?? config;
      const router = (snap as { agent?: { router?: { costMode?: string } } })
        .agent?.router;
      return router?.costMode ?? "balanced";
    },
  });

  // -------------------------------------------------------------------------
  // Step 5b-workers: Worker Runtime + Reports Store
  // -------------------------------------------------------------------------

  const workerRuntime = new WorkerRuntime(
    {
      autoApprove: (config.workers as { autoApprove?: boolean } | undefined)?.autoApprove ?? false,
      maxConcurrentJobs: (config.workers as { maxConcurrentJobs?: number } | undefined)?.maxConcurrentJobs ?? 3,
      workerTimeoutMs: (config.workers as { workerTimeoutMs?: number } | undefined)?.workerTimeoutMs ?? 300_000,
      reportsDir: join(homedir(), ".agi", "reports"),
      modelMap: {
        haiku: "claude-haiku-4-5-20251001",
        sonnet: config.agent?.model ?? "claude-sonnet-4-6",
        opus: "claude-opus-4-6",
        default: config.agent?.model ?? "claude-sonnet-4-6",
      },
      promptDir: resolvePath(workspaceRoot, "prompts", "workers"),
      stateDir: join(homedir(), ".agi", "state"),
      workspaceRoot,
      resourceId,
      nodeId,
      workerTier: "verified",
    },
    {
      llmProvider: getLLMProvider(),
      toolRegistry,
      getState: () => stateMachine.getState(),
    },
  );

  // Wire the late-bound ref so onJobCreated callbacks reach the runtime.
  workerRuntimeRef.current = workerRuntime;

  // Worker prompt loader — discovers worker prompts from prompts/workers/
  const workerPromptLoader = new WorkerPromptLoader(resolvePath(workspaceRoot, "prompts", "workers"));

  const reportsStore = new ReportsStore(join(homedir(), ".agi", "reports"));
  reportsStore.watch();

  // -------------------------------------------------------------------------
  // Step 5b-security: Security scanning
  // -------------------------------------------------------------------------

  const scanRegistry = new ScanProviderRegistry();
  const scanStore = new ScanStore(db);
  const scanRunner = new ScanRunner(scanRegistry, scanStore, {
    debug: (msg: string) => log.debug(msg),
    info: (msg: string) => log.info(msg),
    warn: (msg: string) => log.warn(msg),
    error: (msg: string) => log.error(msg),
  });

  // Register built-in scanners
  scanRegistry.add("built-in", sastScanner);
  scanRegistry.add("built-in", scaScanner);
  scanRegistry.add("built-in", secretsScanner);
  scanRegistry.add("built-in", configScanner);

  // -------------------------------------------------------------------------
  // Step 5b-plans: Plan store
  // -------------------------------------------------------------------------

  const planStore = new PlanStore();

  // -------------------------------------------------------------------------
  // Step 5c: First-run bootstrap (identity anchoring)
  // -------------------------------------------------------------------------

  {
    const bootstrapMarker = join(userContextDir, ".bootstrapped");
    const bootstrapPromptPath = join(userContextDir, "BOOTSTRAP.md");

    let alreadyBootstrapped = false;
    try {
      readFileSync(bootstrapMarker);
      alreadyBootstrapped = true;
    } catch {
      // Marker missing — not yet bootstrapped
    }

    if (!alreadyBootstrapped) {
      try {
        const bootstrapContent = readFileSync(bootstrapPromptPath, "utf-8");
        if (bootstrapContent.trim().length > 0) {
          log.info("first-run bootstrap: executing identity anchoring...");

          const systemEntity = await entityStore.resolveOrCreate("system", "$BOOTSTRAP", "System Bootstrap");

          const bootstrapCoaFingerprint = await coaLogger.log({
            resourceId,
            entityId: systemEntity.id,
            entityAlias: systemEntity.coaAlias,
            nodeId,
            workType: "action",
          });
          await agentInvoker.process({
            entity: systemEntity,
            channel: "system",
            content: bootstrapContent,
            coaFingerprint: bootstrapCoaFingerprint,
            queueMessageId: "bootstrap-init",
          });

          mkdirSync(dirname(bootstrapMarker), { recursive: true });
          writeFileSync(bootstrapMarker, new Date().toISOString(), "utf-8");
          log.info("first-run bootstrap: complete");
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          log.warn(`bootstrap error: ${err instanceof Error ? err.message : String(err)}`);
        }
        // BOOTSTRAP.md missing or error — skip silently
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 5d: QueueConsumer — wired with onInbound closure
  //
  // The closure extracts the Entity from the message payload before calling
  // agentInvoker.process(). If the entity is not found, fail the message.
  // -------------------------------------------------------------------------

  // replyMode: "autonomous" dispatches directly; "human-in-loop" broadcasts
  // the response via WS for operator approval before dispatching to channel.
  const replyMode = config.agent?.replyMode ?? "autonomous";
  const queueLog = createComponentLogger(logger, "queue");

  // Late-bound WS server reference — populated after createGatewayRuntimeState.
  // The closure is only executed after sidecars start, so wsServer is available.
  const wsRef: { server: import("./ws-server.js").GatewayWebSocketServer | null } = { server: null };

  const queueConsumer = new QueueConsumer(
    {
      messageQueue,
      outboundDispatcher,
      onInbound: async (message) => {
        queueLog.info(`processing message ${message.id} on channel ${message.channel}`);
        const payload = message.payload as { entityId?: string; coaFingerprint?: string; message?: unknown };
        const entityId = payload.entityId;

        if (entityId === undefined) {
          throw new Error(`Queue message ${message.id} missing entityId in payload`);
        }

        const entity = await entityStore.getEntity(entityId);
        if (entity === null) {
          // Throw so QueueConsumer.processMessage() calls fail() — do NOT call
          // fail() here because processMessage() also calls complete() on normal return.
          throw new Error(`Queue message ${message.id} skipped — entity ${entityId} not found`);
        }

        // Extract text content from the AionimaMessage for the agent.
        // payload.message is the full AionimaMessage object — the agent needs
        // the actual text, not the envelope.
        const inboundMsg = payload.message as AionimaMessage | undefined;
        const agentContent = inboundMsg?.content?.type === "text"
          ? inboundMsg.content.text
          : inboundMsg?.content?.type === "voice"
            ? "[voice message]"
            : inboundMsg?.content?.type === "media"
              ? (inboundMsg.content as { caption?: string }).caption ?? "[media]"
              : String(payload.message ?? "");

        queueLog.info(`invoking agent for entity ${entityId}`);
        try {
          const outcome = await agentInvoker.process({
            entity,
            channel: message.channel,
            content: agentContent,
            coaFingerprint: payload.coaFingerprint ?? "",
            queueMessageId: message.id,
            devMode,
            isOwner: ownerEntityId !== undefined && entityId === ownerEntityId,
          });

          queueLog.info(`agent outcome: ${outcome.type}`);

          // Send the response back to the user via outbound dispatcher
          if (outcome.type === "response" && outcome.text) {
            const outboundMsg = payload.message as AionimaMessage | undefined;
            const channelUserId = outboundMsg?.channelUserId;
            const channelId = (outboundMsg?.channelId as string | undefined) ?? message.channel;

            if (replyMode === "human-in-loop") {
              // HiTL: broadcast the pending response to operator dashboards via WS.
              // Operators review via the dashboard and send a reply_request to dispatch.
              queueLog.info(`HiTL mode — broadcasting pending response for entity ${entityId}`);
              wsRef.server?.broadcast("agent_response_pending", {
                entityId,
                channelId,
                channelUserId,
                text: outcome.text,
                coaFingerprint: outcome.coaFingerprint,
                timestamp: new Date().toISOString(),
              });
            } else if (channelUserId) {
              queueLog.info(`sending response to ${channelId}:${channelUserId}`);
              await outboundDispatcher.dispatch({
                channelId,
                channelUserId,
                entityId,
                content: { type: "text", text: outcome.text },
              });
              queueLog.info("response sent");
            } else {
              queueLog.warn("no channelUserId — cannot send response");
            }
          } else if (outcome.type === "rate_limited") {
            queueLog.info(`rate limited: ${outcome.entityNotification}`);
          } else if (outcome.type === "error") {
            queueLog.error(`agent error outcome: ${outcome.message}`);
          }
        } catch (err) {
          queueLog.error(`agent error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        }
      },
    },
    {
      pollIntervalMs: config.queue?.pollIntervalMs ?? 100,
      concurrency: config.queue?.concurrency ?? 10,
      drainTimeoutMs: config.queue?.drainTimeoutMs ?? 5000,
    },
  );

  // -------------------------------------------------------------------------
  // Step 5d: Dashboard services
  // -------------------------------------------------------------------------

  const dashboardQueries = new DashboardQueries(db);
  const dashboardApi = new DashboardApi({ queries: dashboardQueries });

  // -------------------------------------------------------------------------
  // Step 5e: Hosting manager (optional, config-gated)
  // -------------------------------------------------------------------------

  const hostingConfig = config.hosting;
  const projectTypeRegistry = createProjectTypeRegistry();

  // -------------------------------------------------------------------------
  // Step 5f-pre: Initialize ADF facades for core dogfooding
  // -------------------------------------------------------------------------

  {
    const { initADF, Log } = await import("@agi/sdk");
    initADF({
      logger: createComponentLogger(logger, "adf"),
      config: config as Record<string, unknown>,
      workspaceRoot,
      projectDirs: projectPaths,
      security: {
        runScan: (cfg) => scanRunner.runScan(cfg as Parameters<typeof scanRunner.runScan>[0]),
        getFindings: (scanId) => scanStore.getFindings(scanId),
        getScanHistory: (projectPath, limit) => scanStore.listScanRuns({ projectPath, limit }),
        getProviders: () => scanRunner.getProviders(),
      },
      projectConfig: {
        read: (p) => projectConfigManager.read(p) as Record<string, unknown> | null,
        readHosting: (p) => projectConfigManager.readHosting(p) as Record<string, unknown> | null,
        getStacks: (p) => projectConfigManager.getStacks(p),
      },
      systemConfig: systemConfigService ? {
        read: () => systemConfigService.read() as Record<string, unknown>,
        readKey: (k) => systemConfigService.readKey(k),
        patch: (k, v) => systemConfigService.patch(k, v),
      } : undefined,
    });
    Log().info("ADF initialized — facades available");
  }

  // -------------------------------------------------------------------------
  // Step 5f: Plugin system — marketplace, auto-install, discover, load
  // -------------------------------------------------------------------------

  // Create the marketplace manager early so we can auto-install required plugins.
  const pluginCacheDir = join(homedir(), ".agi", "plugins", "cache");
  const marketplaceStore = new MarketplaceStore(db);
  const marketplaceManager = new MarketplaceManager({
    store: marketplaceStore,
    workspaceRoot,
    cacheDir: pluginCacheDir,
    installDir: process.cwd(),
  });

  // Seed default marketplace source. Dev Mode routes to the owner's fork;
  // otherwise Civicognita on the configured update channel. The resolver
  // is pure (see `dev-mode-sources.ts`), so the auto-sync scheduled task
  // below re-evaluates on every tick — toggling Dev Mode takes effect at
  // the next poll without requiring a restart.
  const updateChannel = config.gateway?.updateChannel ?? "main";
  const marketplaceRef = resolveMarketplaceSource(config, "plugin");
  const existingSources = marketplaceManager.getSources();
  if (existingSources.length === 0) {
    marketplaceManager.addSource(marketplaceRef, "Aionima");
    log.info(`plugin-marketplace: seeded default source (${marketplaceRef})`);
  } else {
    const defaultSource = existingSources[0]!;
    if (defaultSource.ref !== marketplaceRef) {
      marketplaceManager.removeSource(defaultSource.id);
      marketplaceManager.addSource(marketplaceRef, "Aionima");
      log.info(`plugin-marketplace: updated source to ${marketplaceRef}`);
    }
  }

  // Sync marketplace catalog from GitHub AND auto-update any installed plugin
  // whose catalog version is newer than its installed version. Runs BEFORE
  // plugin discovery (line ~1170) so the loader reads freshly-updated content
  // from ~/.agi/plugins/cache/. Without this, installed plugins stay frozen at
  // install time forever — even after `agi upgrade` pulls the catalog.
  try {
    const result = await marketplaceManager.syncAndUpdateAll();
    log.info(`plugin-marketplace: catalog synced (${String(result.synced)} plugins total)`);
    if (result.updated.length > 0) {
      log.info(`plugin-marketplace: auto-updated ${String(result.updated.length)} plugin(s) -> ${result.updated.join(", ")}`);
    }
    if (result.errors.length > 0) {
      log.warn(`plugin-marketplace: ${String(result.errors.length)} plugin update(s) failed: ${result.errors.join("; ")}`);
    }
  } catch (err) {
    log.error(`plugin-marketplace: sync/update failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Auto-install missing required plugins from the official marketplace.
  // Required plugins auto-install, auto-update, and can't be uninstalled.
  const requiredPluginsPath = join(process.cwd(), "config/required-plugins.json");
  if (existsSync(requiredPluginsPath)) {
    try {
      const reqData = JSON.parse(readFileSync(requiredPluginsPath, "utf-8")) as {
        plugins: Array<{ id: string }>;
      };
      const sources = marketplaceManager.getSources();
      const defaultSourceId = sources[0]?.id;

      if (defaultSourceId !== undefined) {
        for (const req of reqData.plugins) {
          // Check if installed AND has a built dist/index.js.
          // If the cache entry exists but wasn't built, force-reinstall.
          const isInDb = await marketplaceManager.isInstalled(req.id);
          const cacheEntry = join(pluginCacheDir, req.id);
          const hasBuilt = existsSync(join(cacheEntry, "dist", "index.js"));

          if (isInDb && !hasBuilt) {
            log.info(`repairing unbuilt install for required plugin: ${req.id}`);
            await marketplaceManager.uninstall(req.id, true);
          }

          if (!isInDb || !hasBuilt) {
            log.info(`auto-installing required plugin: ${req.id}`);
            try {
              const result = await marketplaceManager.install(req.id, defaultSourceId);
              if (result.ok) {
                log.info(`installed required plugin: ${req.id}`);
              } else {
                log.warn(`failed to auto-install ${req.id}: ${result.error ?? "unknown"}`);
              }
            } catch (err) {
              log.warn(`failed to auto-install ${req.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }

      // Auto-uninstall plugins that were previously required but removed.
      // If a plugin is installed, came from the default source, is no longer required,
      // AND is no longer in the synced catalog, clean it up.
      const requiredIds = new Set(reqData.plugins.map((p) => p.id));
      const [installed, catalogEntries] = await Promise.all([
        marketplaceManager.getInstalled(),
        marketplaceManager.searchCatalog({}),
      ]);
      const catalogNames = new Set(catalogEntries.map((c) => c.name));
      for (const item of installed) {
        if (!requiredIds.has(item.name) && !catalogNames.has(item.name)) {
          log.info(`auto-uninstalling removed plugin: ${item.name} (not in catalog or required list)`);
          try {
            await marketplaceManager.uninstall(item.name, true);
          } catch (err) {
            log.warn(`failed to auto-uninstall ${item.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch (err) {
      log.warn(`failed to load required-plugins.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const pluginRegistry = new PluginRegistry();
  pluginRegistryRef.current = pluginRegistry;

  // TaskMaster Orchestrator — LLM-powered work decomposition. Uses the
  // same LLM provider as Aion to decompose work descriptions into ordered
  // sequences of worker phases.
  const { TaskmasterOrchestrator } = await import("./taskmaster-orchestrator.js");
  const taskmasterOrchestrator = new TaskmasterOrchestrator(llmProvider);
  taskmasterOrchestratorRef.current = taskmasterOrchestrator;

  const hookBus = new HookBus();
  const installDir = process.cwd();
  const pluginSearchPaths = getDefaultSearchPaths({ workspaceRoot, installDir });
  const discovered = discoverPlugins(pluginSearchPaths);

  const seenIds = new Set(discovered.plugins.map(p => p.manifest.id));

  // Scan installed plugins from the plugin cache (where the marketplace
  // installer places them at install time).
  const installedDiscovery = discoverPlugins([pluginCacheDir]);
  for (const ip of installedDiscovery.plugins) {
    if (!seenIds.has(ip.manifest.id)) {
      discovered.plugins.push(ip);
      seenIds.add(ip.manifest.id);
    }
  }
  discovered.errors.push(...installedDiscovery.errors);
  if (installedDiscovery.plugins.length > 0) {
    log.info(`plugin-marketplace: ${String(installedDiscovery.plugins.length)} installed from cache`);
  }

  // Ensure all cached plugins have marketplace DB records so version updates work.
  // Plugins installed before DB tracking existed may be in cache but not in the DB.
  {
    const sources = marketplaceManager.getSources();
    const defaultSourceId = sources[0]?.id;
    if (defaultSourceId !== undefined) {
      let backfilled = 0;
      for (const ip of installedDiscovery.plugins) {
        if (!await marketplaceManager.isInstalled(ip.manifest.id)) {
          const catalogEntries = await marketplaceManager.searchCatalog({ q: ip.manifest.id });
          const match = catalogEntries.find(c => c.name === ip.manifest.id);
          marketplaceManager.backfillInstalled({
            name: ip.manifest.id,
            sourceId: match?.sourceId ?? defaultSourceId,
            type: "plugin",
            version: ip.manifest.version ?? "0.0.0",
            installedAt: new Date().toISOString(),
            installPath: join(pluginCacheDir, ip.manifest.id),
            sourceJson: match ? JSON.stringify(match.source) : "{}",
          });
          backfilled++;
        }
      }
      if (backfilled > 0) {
        log.info(`plugin-marketplace: backfilled ${String(backfilled)} DB records for cached plugins`);
      }
    }
  }

  // Now that all cached plugins are tracked in the DB, check for version updates.
  {
    const syncResult = await marketplaceManager.syncAndUpdateAll();
    if (syncResult.updated.length > 0) {
      log.info(`plugin-marketplace: updated ${String(syncResult.updated.length)} plugin(s): ${syncResult.updated.join(", ")}`);
    }
    for (const err of syncResult.errors) {
      log.warn(`plugin-marketplace: update error: ${err}`);
    }
  }

  // Channel plugins are installed from the marketplace like all other plugins.
  // The channels/ directory in the repo is the source for marketplace packaging
  // — it is NOT auto-discovered at boot. Install channels via the dashboard.

  const pluginPrefs = (config as Record<string, unknown>).plugins as Record<string, { enabled?: boolean; priority?: number }> | undefined;
  {
    for (const err of discovered.errors) {
      log.warn(`plugin discovery: ${err.path} — ${err.error}`);
    }
    log.info(`plugins: discovered ${String(discovered.plugins.length)} plugins`);

    // Load required plugins declaration — these are default plugins that
    // auto-install from the official marketplace, auto-update, and can't be
    // uninstalled. They're still marketplace plugins, not hardcoded into AGI.
    const requiredPluginsPath = join(installDir, "config/required-plugins.json");
    if (existsSync(requiredPluginsPath)) {
      try {
        const reqData = JSON.parse(readFileSync(requiredPluginsPath, "utf-8")) as {
          plugins: Array<{ id: string; minVersion?: string; disableable: boolean }>;
        };
        const reqMap = new Map(reqData.plugins.map(r => [r.id, r]));

        for (const dp of discovered.plugins) {
          const req = reqMap.get(dp.manifest.id);
          if (req) {
            dp.manifest.bakedIn = true;
            dp.manifest.disableable = req.disableable;
          } else {
            // Ignore self-declared bakedIn — AGI is the authority
            dp.manifest.bakedIn = false;
          }
        }

        // Warn about missing required plugins
        for (const [reqId] of reqMap) {
          if (!seenIds.has(reqId)) {
            log.error(`required plugin "${reqId}" not found in any plugin directory`);
          }
        }
      } catch (err) {
        log.warn(`failed to load required-plugins.json: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // All discovered plugins are installed plugins (from search paths or
    // the install cache). Only skip if explicitly disabled in config.
    const enabledPlugins = discovered.plugins.filter(p =>
      pluginPrefs?.[p.manifest.id]?.enabled !== false,
    );

    // Build priority map from config
    const pluginPriorities: Record<string, number> = {};
    if (pluginPrefs) {
      for (const [id, pref] of Object.entries(pluginPrefs)) {
        if (pref.priority !== undefined) pluginPriorities[id] = pref.priority;
      }
    }

    if (enabledPlugins.length > 0) {
      const result = await loadPlugins(enabledPlugins, {
        pluginRegistry,
        hookBus,
        projectTypeRegistry,
        config: config as Record<string, unknown>,
        logger,
        workspaceRoot: opts?.configPath ? dirname(resolvePath(opts.configPath)) : workspaceRoot,
        projectDirs: projectPaths,
        pluginPriorities,
        channelRegistry,
        channelConfigs: config.channels as Array<{ id: string; enabled: boolean; config?: Record<string, unknown> }>,
      });
      log.info(`plugins: ${String(result.loaded.length)} loaded, ${String(result.failed.length)} failed`);
      if (discovered.plugins.length > enabledPlugins.length) {
        log.info(`plugins: ${String(discovered.plugins.length - enabledPlugins.length)} disabled by config`);
      }

      // Bridge plugin-registered agent tools, skills, and knowledge into core registries
      bridgePluginCapabilities({ pluginRegistry, toolRegistry, skillRegistry, logger });

      // Wire plugin-registered workers into the worker runtime so TaskMaster
      // uses plugin-contributed prompts, not the old filesystem .md files.
      workerRuntime.setPluginWorkers(pluginRegistry);

      // Wire plugin-contributed LLM providers into the factory so
      // `agent.provider: "claude-max"` (or any plugin type) resolves at
      // config-change time without hardcoding every provider.
      setPluginProviderRegistry(pluginRegistry as unknown as Parameters<typeof setPluginProviderRegistry>[0]);

      // If the configured provider is plugin-contributed (not built-in),
      // recreate the LLM provider now that plugins have loaded. On first
      // boot, createLLMProvider ran before plugins — so it threw for unknown
      // types. Recreating here picks up the plugin factory.
      try {
        const agentProvider = (config.agent as { provider?: string } | undefined)?.provider ?? "anthropic";
        if (!["anthropic", "openai", "ollama", "hf-local"].includes(agentProvider)) {
          try {
            llmProvider = createAgentRouter(config, logger);
            wireProviderErrorCallback(llmProvider);
            wireCostLedger(llmProvider);
            log.info(`LLM provider switched to plugin-contributed "${agentProvider}"`);
          } catch {
            // Provider not registered by any loaded plugin. Check if the
            // marketplace catalog has a matching plugin and auto-install it
            // so the user doesn't have to manually browse Settings → Plugins.
            const catalogName = `provider-${agentProvider}`;
            const catalog = await marketplaceManager.searchCatalog({});
            const match = catalog.find((p) => p.name === catalogName || p.name === agentProvider);
            if (match && !match.installed) {
              log.info(`auto-installing provider plugin "${match.name}" from marketplace (config references "${agentProvider}")`);
              try {
                const installResult = await marketplaceManager.install(match.name, match.sourceId);
                if (installResult.ok && installResult.installPath) {
                  // Hot-load the newly installed plugin
                  const discovery = tryLoadManifest(installResult.installPath);
                  if (!("error" in discovery) && !pluginRegistry.has(discovery.manifest.id)) {
                    await loadPlugins([discovery], {
                      pluginRegistry,
                      hookBus,
                      projectTypeRegistry,
                      config: config as Record<string, unknown>,
                      logger,
                      workspaceRoot: opts?.configPath ? dirname(resolvePath(opts.configPath)) : workspaceRoot,
                      projectDirs: projectPaths,
                      pluginPriorities: Object.fromEntries(
                        Object.entries(pluginPrefs ?? {}).filter(([, v]) => v.priority !== undefined).map(([k, v]) => [k, v.priority!]),
                      ),
                      channelRegistry,
                      channelConfigs: config.channels as Array<{ id: string; enabled: boolean; config?: Record<string, unknown> }>,
                    });
                    bridgePluginCapabilities({ pluginRegistry, toolRegistry, skillRegistry, logger });
                    // Retry provider creation now that the plugin is loaded
                    setPluginProviderRegistry(pluginRegistry as unknown as Parameters<typeof setPluginProviderRegistry>[0]);
                    llmProvider = createAgentRouter(config, logger);
                    log.info(`LLM provider "${agentProvider}" auto-installed and activated from marketplace`);
                  }
                } else {
                  log.warn(`auto-install of "${match.name}" failed: ${installResult.error ?? "unknown"}`);
                }
              } catch (installErr) {
                log.warn(`auto-install of "${catalogName}" failed: ${installErr instanceof Error ? installErr.message : String(installErr)}`);
              }
            } else {
              log.warn(`plugin provider init failed: no plugin for "${agentProvider}" in marketplace catalog`);
            }
          }
        }
      } catch (err) {
        log.warn(`plugin provider init failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 5g: ServiceManager — infrastructure services from plugins
  // -------------------------------------------------------------------------

  const servicesConfig = (config as Record<string, unknown>).services as { overrides?: Record<string, { enabled?: boolean; port?: number; env?: Record<string, string> }> } | undefined;
  const serviceManager = new ServiceManager({
    containerRuntime: hostingConfig?.containerRuntime ?? "podman",
    dataDir: join(installDir, ".aionima"),
    logger,
    pluginRegistry,
    serviceOverrides: servicesConfig?.overrides,
  });

  // -------------------------------------------------------------------------
  // Step 5h: StackRegistry + SharedContainerManager
  // -------------------------------------------------------------------------

  const stackRegistry = new StackRegistry();

  // Populate from plugin registrations
  for (const rs of pluginRegistry.getStacks()) {
    stackRegistry.register(rs.stack);
  }

  // Shared port tracking set (also used by HostingManager via SharedContainerManager)
  const hostingAllocatedPorts = new Set<number>();

  const sharedContainerManager = new SharedContainerManager({
    logger,
    allocatePort: () => {
      const start = hostingConfig?.portRangeStart ?? 4000;
      for (let p = start; p < start + 100; p++) {
        if (!hostingAllocatedPorts.has(p)) {
          hostingAllocatedPorts.add(p);
          return p;
        }
      }
      throw new Error("No free ports in hosting range");
    },
    releasePort: (p: number) => { hostingAllocatedPorts.delete(p); },
  });

  // MApp discovery — load MApps from ~/.agi/mapps/ (independent of plugins)
  const { MAppRegistry } = await import("./mapp-registry.js");
  const { discoverMApps } = await import("./mapp-discovery.js");
  const mappRegistry = new MAppRegistry();
  const mappsDir = join(homedir(), ".agi", "mapps");
  const mappDiscoveryResult = discoverMApps(mappsDir, mappRegistry, logger);
  log.info(`MApps: ${String(mappDiscoveryResult.loaded)} loaded, ${String(mappDiscoveryResult.skipped)} skipped`);

  // MApp Marketplace Manager — multi-source MApp catalog, install, and updates
  const { MAppMarketplaceManager } = await import("@agi/marketplace");
  const mappMarketplaceManager = new MAppMarketplaceManager({
    store: marketplaceManager.getStore(),
    mappsDir,
    updateChannel,
  });

  // Seed official MApp Marketplace source if none exist
  {
    const mappSources = mappMarketplaceManager.getSources();
    const mappRef = resolveMarketplaceSource(config, "mapp");
    if (mappSources.length === 0) {
      mappMarketplaceManager.addSource(mappRef, "Aionima MApps");
      log.info(`mapp-marketplace: seeded default source (${mappRef})`);
    } else if (mappSources[0]!.ref !== mappRef) {
      mappMarketplaceManager.removeSource(mappSources[0]!.id);
      mappMarketplaceManager.addSource(mappRef, "Aionima MApps");
      log.info(`mapp-marketplace: updated source to ${mappRef}`);
    }
  }

  const hostingManager = new HostingManager({
    config: {
      enabled: hostingConfig?.enabled ?? false,
      lanIp: hostingConfig?.lanIp ?? "192.168.0.144",
      baseDomain: hostingConfig?.baseDomain ?? "ai.on",
      domainAliases: hostingConfig?.domainAliases,
      gatewayPort: port,
      portRangeStart: hostingConfig?.portRangeStart ?? 4000,
      containerRuntime: hostingConfig?.containerRuntime ?? "podman",
      statusPollIntervalMs: hostingConfig?.statusPollIntervalMs ?? 10_000,
      tunnelMode: hostingConfig?.tunnelMode ?? "named",
      tunnelDomain: hostingConfig?.tunnelDomain,
      idService: (() => {
        const idCfg = (config as Record<string, unknown>).idService as { local?: { enabled?: boolean; subdomain?: string; port?: number } } | undefined;
        return idCfg?.local?.enabled ? {
          enabled: true,
          subdomain: idCfg.local.subdomain ?? "id",
          port: idCfg.local.port ?? 3200,
        } : undefined;
      })(),
    },
    workspaceProjects: projectPaths,
    projectTypeRegistry,
    pluginRegistry,
    stackRegistry,
    sharedContainerManager,
    projectConfigManager,
    mappRegistry,
    logger,
  });

  // -------------------------------------------------------------------------
  // Step 5h-early: Caddy system domains (dashboard reverse proxy available ASAP)
  // -------------------------------------------------------------------------

  hostingManager.regenerateSystemDomains();

  // Populate late-bound refs so project tools can access hosting/stack/mapp data
  hostingManagerRef.current = hostingManager;
  stackRegistryRef.current = stackRegistry;
  mappRegistryRef.current = mappRegistry;

  // -------------------------------------------------------------------------
  // Terminal session manager
  // -------------------------------------------------------------------------

  const terminalManager = new TerminalManager();

  // MarketplaceManager created earlier (Step 5f) for required plugin auto-install.

  // -------------------------------------------------------------------------
  // Step 5i: Model Runtime — HuggingFace model serving (always initialized,
  //          config-gated at request time so hf.enabled can be hot-swapped)
  // -------------------------------------------------------------------------

  const hfCacheDir = (() => {
    const hfConf = (config as Record<string, unknown>).hf as { cacheDir?: string } | undefined;
    return (hfConf?.cacheDir ?? "~/.agi/models").replace(/^~/, homedir());
  })();
  mkdirSync(join(hfCacheDir, "hub"), { recursive: true });

  const modelRuntimeEvents = new EventEmitter() as ModelRuntimeEventEmitter;
  const hardwareProfiler = new HardwareProfiler(hfCacheDir);
  const hfClient = new HfHubClient({
    apiToken: ((config as Record<string, unknown>).hf as { apiToken?: string } | undefined)?.apiToken,
  });

  // ModelStore + DatasetStore use the shared db connection.
  // Degrade gracefully when Postgres is unreachable — a gateway with HF models
  // unavailable is better than a gateway that refuses to boot. Test VMs
  // and fresh installs (before `agi-local-id` is up) hit this path.
  const modelStore = new ModelStore(db);
  try {
    const reconciledModels = await modelStore.reconcileFromDisk(
      hfCacheDir,
      async (modelId) => {
        try { return await hfClient.getModelInfo(modelId); }
        catch { return null; }
      },
    );
    if (reconciledModels > 0) {
      log.info(`HF model store: reconciled ${String(reconciledModels)} model(s) from disk`);
    }

    // GC pass — run after reconcile so legitimate models are in the DB first.
    // Fire-and-forget; failures are logged but never crash the gateway.
    cleanupHubOrphans(hfCacheDir, modelStore)
      .then((gcResult) => {
        if (gcResult.removed.length > 0) {
          log.info(
            `HF hub GC: removed ${String(gcResult.removed.length)} orphaned model director${gcResult.removed.length === 1 ? "y" : "ies"}: ${gcResult.removed.join(", ")}`,
          );
        }
        if (gcResult.errors.length > 0) {
          log.warn(`HF hub GC errors: ${gcResult.errors.join("; ")}`);
        }
      })
      .catch((err) => {
        log.warn(`HF hub GC failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  } catch (err) {
    log.warn(`ModelStore (HF models) disabled — Postgres unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const datasetsCacheDir = join(homedir(), ".agi", "datasets");
  mkdirSync(join(datasetsCacheDir, "hub"), { recursive: true });
  const datasetStore = new DatasetStore(db);

  const profile = hardwareProfiler.scan();

  const hfInitConfig = (config as Record<string, unknown>).hf as
    { portRangeStart?: number; maxConcurrentModels?: number; gpuMode?: "auto" | "nvidia" | "amd" | "cpu-only"; images?: { llm?: string; diffusion?: string; general?: string }; inferenceTimeoutMs?: number; autoStart?: string[]; enabled?: boolean }
    | undefined;

  const modelContainerManager = new ModelContainerManager(
    {
      portRangeStart: hfInitConfig?.portRangeStart ?? 6000,
      maxConcurrentModels: hfInitConfig?.maxConcurrentModels ?? 3,
      gpuMode: hfInitConfig?.gpuMode ?? "auto",
      images: hfInitConfig?.images,
      statePath: join(homedir(), ".agi", "model-containers.json"),
    },
    modelRuntimeEvents,
  );

  // Wire model runtime deps into HostingManager so project containers can receive
  // AI model env vars (AIONIMA_MODEL_*_URL) and dataset volume mounts.
  // Called here because modelStore + modelContainerManager are created in Step 5i,
  // after the HostingManager is constructed in Step 5h.
  hostingManager.setModelDeps({ modelStore, modelContainerManager });

  const capabilityResolver = new CapabilityResolver(profile.capabilities);
  const inferenceGateway = new InferenceGateway(modelStore, hfInitConfig?.inferenceTimeoutMs ?? 120_000);

  const modelAgentBridge = new ModelAgentBridge(
    modelRuntimeEvents,
    modelStore,
    inferenceGateway,
    profile.capabilities,
  );

  // Wire the bridge into the LLM factory so "hf-local" provider type
  // resolves the actual container port dynamically instead of hardcoding 6000.
  setModelAgentBridge(modelAgentBridge);

  // Known-models registry and custom container builder
  const knownModelsRegistry = new KnownModelsRegistry(
    join(homedir(), ".agi", "custom-runtimes"),
  );
  const customContainerBuilder = new CustomContainerBuilder(hfCacheDir);

  // Fine-tune manager — jobs run in dedicated Podman containers
  const fineTuneManager = new FineTuneManager(
    modelStore,
    datasetStore,
    join(homedir(), ".agi", "finetune"),
  );

  // Always store deps — routes are always registered and check hf.enabled at request time
  const hfApiDeps: Parameters<typeof registerHfRoutes>[1] = {
    hardwareProfiler,
    hfClient,
    modelStore,
    datasetStore,
    containerManager: modelContainerManager,
    capabilityResolver,
    inferenceGateway,
    agentBridge: modelAgentBridge,
    knownModelsRegistry,
    customContainerBuilder,
    fineTuneManager,
    hfCacheDir,
    isEnabled: () => Boolean(((config as Record<string, unknown>).hf as { enabled?: boolean } | undefined)?.enabled),
  };

  // -------------------------------------------------------------------------
  // Step 5i2: Local model runtime (small model for safemode investigator + doctor)
  // -------------------------------------------------------------------------

  const opsConfig = (config as Record<string, unknown>).ops as
    | { localModel?: { modelId?: string }; aionMicro?: { enabled?: boolean; port?: number; idleTimeoutMs?: number } }
    | undefined;

  const aionMicroManager = new AionMicroManager(
    opsConfig?.aionMicro,
    createComponentLogger(logger, "aion-micro"),
  );

  const localModelRuntime = new LocalModelRuntime(
    modelStore,
    inferenceGateway,
    { modelId: opsConfig?.localModel?.modelId ?? DEFAULT_LOCAL_MODEL_ID },
    createComponentLogger(logger, "local-model"),
    aionMicroManager,
  );

  // If we booted into safemode, fire the investigator async (don't block boot).
  // The investigator writes a report to ~/.agi/incidents/ and surfaces a
  // notification the user sees in the dashboard.
  if (isSafemodeBoot) {
    void runInvestigator(createComponentLogger(logger, "investigator"), {
      localModel: localModelRuntime,
      notificationStore,
    });
  }

  // Auto-start models if HF is enabled at boot — but skip in safemode so a
  // crashed container can't re-trigger whatever broke us last time.
  if (hfInitConfig?.enabled && !isSafemodeBoot) {
    const autoStartIds = hfInitConfig.autoStart ?? [];
    for (const modelId of autoStartIds) {
      const model = await modelStore.getById(modelId);
      if (model !== undefined && model.status === "ready") {
        const containerConfig = capabilityResolver.buildContainerConfig(model, hfInitConfig.images);
        modelContainerManager.start(model, containerConfig).catch((err) => {
          log.error(`HF auto-start failed for ${modelId}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }
    log.info(`HF Model Runtime enabled — hardware tier: ${profile.capabilities.tier}, cache: ${hfCacheDir}`);
  } else if (hfInitConfig?.enabled && isSafemodeBoot) {
    log.warn("HF Model Runtime: auto-start SKIPPED (safemode boot)");
  } else {
    log.info("HF Model Runtime initialized (disabled — enable via Settings > HF Marketplace)");
  }

  // Background health monitor — checks running HF model containers every 30 s.
  // Resets stale "running" DB entries and evicts dead containers from the
  // in-memory map so they don't block port allocation.
  const hfModelStopNotified = new Set<string>();
  const hfHealthMonitorInterval = setInterval(() => {
    void (async () => {
      try {
        const running = modelContainerManager.getRunning();
        for (const state of running) {
          // Skip models still loading (start() hasn't finished health check yet)
          const dbModel = await modelStore.getById(state.modelId);
          if (dbModel?.status === "starting") continue;

          const healthy = await modelContainerManager.probeHealth(state.modelId);
          if (!healthy) {
            await modelStore.updateStatus(state.modelId, "ready");
            modelContainerManager.removeFromActive(state.modelId);
            log.warn(`HF model ${state.modelId} container unhealthy — status reset to ready`);
            if (!hfModelStopNotified.has(state.modelId)) {
              hfModelStopNotified.add(state.modelId);
              dashboardBroadcasterRef?.emitNotification({
                id: `hf-model-stopped-${state.modelId}-${Date.now()}`,
                type: "warning",
                title: "Model stopped",
                body: `${state.modelId} container is no longer responding`,
                metadata: { modelId: state.modelId },
                createdAt: new Date().toISOString(),
              });
            }
          } else {
            hfModelStopNotified.delete(state.modelId);
          }
        }

        // Watchdog: reset "starting" models stuck for > 5 minutes with no container
        const allModels = await modelStore.getAll();
        for (const model of allModels) {
          if (model.status === "starting") {
            const container = modelContainerManager.getStatus(model.id);
            if (!container) {
              const changedAt = model.statusChangedAt;
              if (!changedAt || Date.now() - new Date(changedAt).getTime() > 5 * 60 * 1000) {
                await modelStore.setError(model.id, "Container start timed out — try again from the Installed tab");
                log.warn(`HF model ${model.id} start timed out — reset to error`);
              }
            }
          }
        }
      } catch { /* health check cycle failed — skip */ }
    })();
  }, 30_000);

  // -------------------------------------------------------------------------
  // Step 3f: Federation & Identity subsystems
  // -------------------------------------------------------------------------

  const fedConfig = (config as Record<string, unknown>).federation as
    | { enabled?: boolean; publicUrl?: string; seedPeers?: string[]; autoGeid?: boolean; allowVisitors?: boolean }
    | undefined;

  let federationNode: FederationNode | undefined;
  let federationRouter: FederationRouter | undefined;
  let identityProvider: IdentityProvider | undefined;
  let oauthHandler: OAuthHandler | null = null;
  let visitorAuth: VisitorAuthManager | undefined;

  if (fedConfig?.enabled) {
    const nodeKeypair = generateNodeKeypair();
    const peerStore = new FederationPeerStore(db);
    federationNode = new FederationNode({
      nodeId: ulid(),
      displayName: config.owner?.displayName ?? "Aionima Node",
      federationEndpoint: fedConfig.publicUrl ?? `http://${host}:${port}`,
      genesisSeal: "",
      privateKeyPem: nodeKeypair.privateKeyPem,
      peerStore,
    });
    federationRouter = new FederationRouter(federationNode);
    identityProvider = new IdentityProvider(entityStore, federationNode);

    const sessionSecret = ulid();
    visitorAuth = new VisitorAuthManager({ sessionSecret });

    const identityConfig = (config as Record<string, unknown>).identity as
      | { oauth?: { google?: { clientId: string; clientSecret: string }; github?: { clientId: string; clientSecret: string } } }
      | undefined;

    if (identityConfig?.oauth) {
      const callbackBaseUrl = fedConfig.publicUrl ?? `http://${host}:${port}`;
      oauthHandler = new OAuthHandler(identityConfig.oauth, callbackBaseUrl);
    }

    log.info("Federation enabled — identity provider active");
  }

  // -------------------------------------------------------------------------
  // Step 3g: Agent tools — marketplace, plugins, config, stacks, system, hosting
  // -------------------------------------------------------------------------

  const agentToolCount = registerAgentTools(toolRegistry, {
    configPath: opts?.configPath,
    marketplaceManager,
    pluginRegistry,
    pluginPrefs,
    discoveredPlugins: discovered.plugins.map(d => ({
      id: d.manifest.id,
      name: d.manifest.name,
      version: d.manifest.version,
      description: d.manifest.description,
      category: d.manifest.category ?? "tool",
      provides: d.manifest.provides,
      depends: d.manifest.depends,
      basePath: d.basePath,
      bakedIn: d.manifest.bakedIn ?? false,
      disableable: d.manifest.disableable ?? true,
    })),
    stackRegistry,
    hostingManager,
    projectDirs: projectPaths,
    selfRepoPath: config.workspace?.selfRepo,
    systemConfigService: systemConfigService ?? undefined,
    mappRegistry,
  });
  log.info(`registered ${String(agentToolCount)} agent tools`);

  // Register HF model management tool for the agent
  toolRegistry.register(
    {
      name: "hf_models",
      description: "Manage HuggingFace models and datasets — search the Hub, list installed models, check hardware capabilities, search datasets, list model API endpoints, and check running model status. Use this tool when the user asks about AI models, HuggingFace, model downloads, local inference, datasets, or building AI apps.",
      requiresState: [],
      requiresTier: [],
    },
    async (input: Record<string, unknown>) => {
      const action = String(input.action ?? "list");
      const hfEnabled = ((config as Record<string, unknown>).hf as { enabled?: boolean } | undefined)?.enabled;

      if (!hfEnabled && action !== "hardware" && action !== "status") {
        return JSON.stringify({ error: "HF Marketplace is not enabled. Ask the user to enable it in Settings > HF Marketplace." });
      }

      switch (action) {
        case "search": {
          const q = String(input.query ?? "");
          const task = input.task as string | undefined;
          const results = await hfClient.searchModels({ search: q, pipeline_tag: task, limit: 5 });
          return JSON.stringify(results.map((m) => ({ id: m.id, task: m.pipeline_tag, downloads: m.downloads, likes: m.likes })));
        }
        case "list": {
          const allModels = await modelStore.getAll();
          return JSON.stringify(allModels.map((m) => ({ id: m.id, status: m.status, runtime: m.runtimeType, size: m.fileSizeBytes })));
        }
        case "running": {
          const runningModels = (await modelStore.getAll()).filter((m) => m.status === "running");
          return JSON.stringify(runningModels.map((m) => ({ id: m.id, displayName: m.displayName, runtime: m.runtimeType, port: m.containerPort, pipeline: m.pipelineTag })));
        }
        case "hardware":
          return JSON.stringify(hardwareProfiler.getProfile().capabilities);
        case "status": {
          const allInstalled = await modelStore.getAll();
          const runningCount = allInstalled.filter((m) => m.status === "running").length;
          return JSON.stringify({ enabled: hfEnabled ?? false, installed: allInstalled.length, running: runningCount, tier: hardwareProfiler.getProfile().capabilities.tier });
        }
        case "datasets": {
          const q = String(input.query ?? "");
          const results = await hfClient.searchDatasets({ search: q, limit: 5 });
          return JSON.stringify(results.map((d) => ({ id: d.id, downloads: d.downloads, likes: d.likes, tags: d.tags })));
        }
        case "endpoints": {
          const modelId = String(input.modelId ?? "");
          if (!modelId) {
            return JSON.stringify({ error: "modelId is required for action=endpoints" });
          }
          const model = await modelStore.getById(modelId);
          if (!model) {
            return JSON.stringify({ error: `Model not installed: ${modelId}` });
          }
          return JSON.stringify({ modelId, endpoints: model.endpoints ?? [] });
        }
        default:
          return JSON.stringify({ error: `Unknown action: ${action}. Available: search, list, running, hardware, status, datasets, endpoints` });
      }
    },
    {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "list", "running", "hardware", "status", "datasets", "endpoints"], description: "Action to perform" },
        query: { type: "string", description: "Search query (for action=search or action=datasets)" },
        task: { type: "string", description: "Pipeline task filter (for action=search), e.g. text-generation, text-to-image" },
        modelId: { type: "string", description: "HuggingFace model ID in author/repo format (for action=endpoints)" },
      },
      required: ["action"],
    },
  );

  // -------------------------------------------------------------------------
  // Step 4: Runtime state creation (HTTP + WS servers)
  //
  // Note: Step 4 is performed after core services are constructed so that
  // the HTTP handler can close over them (channelRegistry, agentSessionManager).
  // -------------------------------------------------------------------------

  // MagicApp state store — persistent app instance state across crashes/reloads
  const { MagicAppStateStore } = await import("./magic-app-state-store.js");
  const magicAppStateStore = new MagicAppStateStore(db);

  const { httpServer, wsServer } = await createGatewayRuntimeState(
    {
      auth,
      stateMachine,
      agentSessionManager,
      channelRegistry,
      dashboardApi,
      entityStore,
      coaLogger,
      resourceId,
      nodeId,
      ownerEntityId,
      wsRef,
      configPath: opts?.configPath,
      staticDir: opts?.staticDir,
      workspaceProjects: projectPaths,
      workspaceRoot,
      selfRepoPath: config.workspace?.selfRepo,
      agiVersion: resolveAgiVersion(config.workspace?.selfRepo),
      webhookSecret: config.workspace?.webhookSecret,
      logger,
      hostingManager,
      commsLog,
      notificationStore,
      chatPersistence,
      imageBlobStore,
      pluginRegistry,
      stackRegistry,
      sharedContainerManager,
      serviceManager,
      usageStore,
      discoveredPlugins: discovered.plugins.map(d => ({
        id: d.manifest.id,
        name: d.manifest.name,
        version: d.manifest.version,
        description: d.manifest.description,
        author: d.manifest.author ?? null,
        permissions: d.manifest.permissions,
        category: d.manifest.category ?? "tool",
        provides: d.manifest.provides,
        depends: d.manifest.depends,
        basePath: d.basePath,
        bakedIn: d.manifest.bakedIn ?? false,
        disableable: d.manifest.disableable ?? true,
      })),
      pluginPrefs,
      primeLoader,
      primeDir,
      aionMicro: aionMicroManager,
        marketplaceManager,
      onPluginInstalled: async (installPath: string) => {
        try {
          // installPath is the plugin's own directory (e.g. ~/.agi/plugins/cache/<id>).
          // Use tryLoadManifest directly — discoverPlugins expects parent dirs
          // and silently returns empty when given a plugin dir.
          const discovery = tryLoadManifest(installPath);
          if ("error" in discovery) {
            return { loaded: false, error: `manifest load failed: ${discovery.error}` };
          }
          const pluginToLoad = discovery;
          if (pluginRegistry.has(pluginToLoad.manifest.id)) {
            return { loaded: true, pluginId: pluginToLoad.manifest.id };
          }
          const result = await loadPlugins([pluginToLoad], {
            pluginRegistry,
            hookBus,
            projectTypeRegistry,
            config: config as Record<string, unknown>,
            logger,
            workspaceRoot: opts?.configPath ? dirname(resolvePath(opts.configPath)) : workspaceRoot,
            projectDirs: projectPaths,
            pluginPriorities: Object.fromEntries(
              Object.entries(pluginPrefs ?? {}).filter(([, v]) => v.priority !== undefined).map(([k, v]) => [k, v.priority!]),
            ),
            channelRegistry,
            channelConfigs: config.channels as Array<{ id: string; enabled: boolean; config?: Record<string, unknown> }>,
          });
          if (result.loaded.length > 0) {
            // Bridge newly registered capabilities and sync stacks to the registry
            bridgePluginCapabilities({ pluginRegistry, toolRegistry, skillRegistry, logger });
            for (const { stack } of pluginRegistry.getStacks()) {
              if (!stackRegistry.get(stack.id)) stackRegistry.register(stack);
            }
            // Regenerate Caddyfile so any subdomain routes the new plugin registered
            // land in the reverse proxy immediately.
            hostingManager.regenerateCaddyfile();
            log.info(`hot-loaded plugin: ${pluginToLoad.manifest.id}`);
            return { loaded: true, pluginId: pluginToLoad.manifest.id };
          }
          return { loaded: false, error: result.failed[0]?.error ?? "Unknown error" };
        } catch (err) {
          return { loaded: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      onPluginUpdated: async (installPath: string) => {
        try {
          // installPath is the plugin's own directory. Use tryLoadManifest
          // directly — discoverPlugins silently returns empty when given a
          // plugin dir instead of a parent, which caused every hot-reload
          // to report success while actually doing nothing.
          const discovery = tryLoadManifest(installPath);
          if ("error" in discovery) {
            return { loaded: false, error: `manifest load failed: ${discovery.error}` };
          }
          const pluginToLoad = discovery;
          // Do NOT check pluginRegistry.has() — the plugin was just deactivated for update
          const result = await loadPlugins([pluginToLoad], {
            pluginRegistry,
            hookBus,
            projectTypeRegistry,
            config: config as Record<string, unknown>,
            logger,
            workspaceRoot: opts?.configPath ? dirname(resolvePath(opts.configPath)) : workspaceRoot,
            projectDirs: projectPaths,
            pluginPriorities: Object.fromEntries(
              Object.entries(pluginPrefs ?? {}).filter(([, v]) => v.priority !== undefined).map(([k, v]) => [k, v.priority!]),
            ),
            channelRegistry,
            channelConfigs: config.channels as Array<{ id: string; enabled: boolean; config?: Record<string, unknown> }>,
          }, { bustCache: true });
          if (result.loaded.length > 0) {
            bridgePluginCapabilities({ pluginRegistry, toolRegistry, skillRegistry, logger });
            for (const { stack } of pluginRegistry.getStacks()) {
              if (!stackRegistry.get(stack.id)) stackRegistry.register(stack);
            }
            // Regenerate Caddyfile in case the updated plugin changed its subdomain route.
            hostingManager.regenerateCaddyfile();
            log.info(`hot-reloaded plugin: ${pluginToLoad.manifest.id}`);
            return { loaded: true, pluginId: pluginToLoad.manifest.id };
          }
          return { loaded: false, error: result.failed[0]?.error ?? "Unknown error" };
        } catch (err) {
          return { loaded: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      onPluginDeactivating: async (pluginId: string) => {
        // 1. Unbridge skills registered by this plugin
        unbridgePluginCapabilities(pluginId, { pluginRegistry, skillRegistry, logger });

        // 2. Unregister stacks owned by this plugin
        for (const { pluginId: pid, stack } of pluginRegistry.getStacks()) {
          if (pid === pluginId) stackRegistry.unregister(stack.id);
        }

        // 3. Unregister project types owned by this plugin
        for (const typeId of pluginRegistry.getProjectTypeIds(pluginId)) {
          projectTypeRegistry.unregister(typeId);
        }

        // 4. Remove hook handlers registered by this plugin
        hookBus.removeForPlugin(pluginId);

        // 5. Deactivate and remove all registrations
        await pluginRegistry.deactivateSingle(pluginId);

        // 6. Regenerate Caddyfile so any subdomain routes the plugin had registered
        // are removed from the reverse proxy.
        hostingManager.regenerateCaddyfile();

        log.info(`deactivated plugin for update: ${pluginId}`);
      },
      secrets,
      config: config as Record<string, unknown>,
      mappRegistry,
      inferenceGateway,
      modelStore,
      mappMarketplaceManager,
      magicAppStateStore,
      identityProvider,
      oauthHandler,
      visitorAuth,
      federationNode,
      federationRouter,
      onReload: () => {
        const primeEntries = primeLoader.index();
        const skillResult = skillRegistry.discover();
        return {
          primeEntries,
          skillCount: skillResult.loaded,
          timestamp: new Date().toISOString(),
        };
      },
      preListenHooks: [
        (f) => registerReportsApi(f, reportsStore),
        (f) => registerWorkerApi(f, workerRuntime, workerPromptLoader, pluginRegistry),
        (f) => registerComplianceRoutes(f, { incidentStore, vendorStore, sessionStore: complianceSessionStore, backupManager }),
        (f) => registerSecurityRoutes(f, { scanRunner, scanStore }),
        (f) => registerUsageRoutes(f, {
          usageStore,
          getRouterStatus: () => {
            const router = llmProvider as AgentRouter;
            const routerConfig = (config.agent as Record<string, unknown> | undefined)?.router as Record<string, unknown> | undefined;
            return {
              costMode: (routerConfig?.costMode as string | undefined) ?? "balanced",
              providers: typeof router.getProviderHealth === "function"
                ? router.getProviderHealth()
                : [{ provider: "anthropic", healthy: true }],
            };
          },
        }),
        (f) => registerProvidersRoutes(f, {
          // Read live config so the catalog + router state reflect any
          // hot-reloaded changes since boot (per s111 t372 contract).
          readConfig: () => systemConfigService?.read() ?? config,
          // Patch config via the same systemConfigService write path the
          // Settings flow uses. Omitted when no config service is wired,
          // which puts the PUT endpoints in read-only-mode (503 response).
          patchConfig: systemConfigService != null
            ? (path, value) => systemConfigService.patch(path, value)
            : undefined,
          // s111 t423 — cost ledger reader thunks for the Providers UX
          // ticker. The reader is constructed once with the same drizzle
          // client as the writer (cycle 26) and reused per request.
          getCostToday: () => costLedgerReader.today(),
          getCostWeek: () => costLedgerReader.week(),
          getCostRecent: (limit) => costLedgerReader.recent(limit),
          // s111 t419 — duck-typed access to the AgentRouter's ring buffer.
          // llmProvider is typed as the abstract LLMProvider interface (since
          // plugin Providers can fill that role too), but the AgentRouter
          // class exposes getRecentDecisions(). When the active provider
          // isn't an AgentRouter (early-boot stub, plugin-provided Provider),
          // the endpoint returns an empty list rather than throwing.
          getRecentDecisions: (limit) => {
            const provider = getLLMProvider() as {
              getRecentDecisions?: (n: number) => Array<{
                provider: string;
                model: string;
                reason: string;
                complexity: string;
                costMode: string;
                escalated: boolean;
                ts?: string;
              }>;
            };
            return typeof provider.getRecentDecisions === "function"
              ? provider.getRecentDecisions(limit)
              : [];
          },
        }),
        (f) => registerAdminRoutes(f, createComponentLogger(logger, "admin-api"), aionMicroManager),
        (f: import("fastify").FastifyInstance) => registerHfRoutes(f, hfApiDeps),
        (f) => registerLemonadeRoutes(f, {
          getConfig: () => config,
          logger: createComponentLogger(logger, "lemonade-api"),
        }),
      ],
    },
    { host, port },
  );

  // Populate wsRef so the HiTL broadcast in onInbound can reach the WS server.
  wsRef.server = wsServer;

  // -------------------------------------------------------------------------
  // Post-upgrade boot detection — if upgrade.sh restarted the service, finalize the upgrade log
  // -------------------------------------------------------------------------
  const selfRepoPath = config.workspace?.selfRepo;
  if (selfRepoPath) {
    const pendingFile = join(selfRepoPath, ".upgrade-pending");
    if (existsSync(pendingFile)) {
      unlinkSync(pendingFile);
      const ts = new Date().toISOString();
      appendUpgradeLog({ phase: "complete", message: "Service restarted successfully", step: "restart", status: "done", timestamp: ts });
      appendUpgradeLog({ phase: "complete", message: "Deploy complete — service restarted", step: "complete", status: "done", timestamp: ts });
      log.info("upgrade: post-restart cleanup complete");
    }
  }

  // -------------------------------------------------------------------------
  // Step 6b: Log streaming — push log entries to subscribed dashboard clients
  // -------------------------------------------------------------------------

  const logSubscribers = new Set<string>();

  logger.onEntry((entry: LogEntry) => {
    if (logSubscribers.size === 0) return;
    for (const connId of logSubscribers) {
      wsServer.sendTo(connId, "log:entry", entry);
    }
  });

  // -------------------------------------------------------------------------
  // Step 6: HTTP route mounting
  //
  // Done inside createGatewayRuntimeState — see server-runtime-state.ts.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Step 7: WebSocket handler attachment
  // -------------------------------------------------------------------------

  // Late-bound dashboard broadcaster reference — populated after Step 8 sidecars start.
  // The chat:send closure only executes during active WS sessions, so the broadcaster
  // is always available by the time it is first needed.
  let dashboardBroadcasterRef: DashboardEventBroadcaster | null = null;

  // Per-session message queue chain — ensures sequential processing per session.
  const sessionProcessingChain = new Map<string, Promise<void>>();

  // Per-session abort controllers — allows cancellation of in-flight invocations.
  const sessionAbortControllers = new Map<string, AbortController>();

  // Track topic subscriptions per connection
  const subscriptions = new Map<string, Set<string>>();

  // Track the latest connectionId per owner entity — updated on every WS message.
  // Event handlers use this to always send to the current connection, even if the
  // browser reconnected during a long tool execution (e.g., Playwright sessions).
  const ownerConnectionMap = new Map<string, string>();

  // Per-session ring buffer of chat:* events. When the browser reconnects, the
  // client sends chat:resume with its last-seen seq number and the server
  // replays missed events from the buffer. Without this, events emitted during
  // a brief WS drop are lost and the client stalls waiting for a terminal
  // event that was sent to a dead connection.
  const chatEventBuffer = new ChatEventBuffer();

  /**
   * Record + send a chat:* event for a session. Injects a monotonic `seq`
   * number into the payload so the client can track missed events. Use
   * instead of `wsServer.sendTo(...)` for any chat event we want replayable
   * on reconnect.
   */
  const recordAndSendChat = (
    sessionId: string | undefined,
    targetConnId: string,
    type: string,
    payload: Record<string, unknown>,
  ): void => {
    if (!sessionId) {
      // Without a sessionId we can't buffer; send directly and hope the
      // connection is still alive.
      wsServer.sendTo(targetConnId, type, payload);
      return;
    }
    const enriched = { ...payload, seq: chatEventBuffer.record(sessionId, type, payload).seq };
    wsServer.sendTo(targetConnId, type, enriched);
  };

  wsServer.on("message", (connectionId: string, message: WSMessage) => { void (async () => {
    // Update the owner → connection mapping on every message
    if (ownerEntityId !== undefined) {
      ownerConnectionMap.set(ownerEntityId, connectionId);
    }
    switch (message.type) {
      case "ping": {
        wsServer.broadcast("pong", null);
        break;
      }

      case "subscribe": {
        const topics = (message.payload as { topics?: string[] })?.topics ?? [];
        subscriptions.set(connectionId, new Set(topics));
        break;
      }

      case "chat:resume": {
        // Client is reconnecting and wants any chat:* events it missed since
        // the last seq it saw. We replay from the per-session ring buffer.
        const p = message.payload as { sessionId?: string; lastSeq?: number } | undefined;
        if (!p?.sessionId || typeof p.lastSeq !== "number") {
          wsServer.sendTo(connectionId, "chat:resume_missed", { sessionId: p?.sessionId ?? null });
          break;
        }
        const result = chatEventBuffer.since(p.sessionId, p.lastSeq);
        if (result.missed) {
          // Session not in the buffer — usually means the server restarted
          // between the last emit and this reconnect. Tell the client so it
          // can surface a clear "state may be incomplete" UI instead of
          // hanging on a thinking indicator that will never clear.
          wsServer.sendTo(connectionId, "chat:resume_missed", { sessionId: p.sessionId });
          break;
        }
        for (const ev of result.events) {
          // Payload already carries its own seq; the replay preserves order.
          const payloadWithSeq = { ...(ev.payload as Record<string, unknown>), seq: ev.seq };
          wsServer.sendTo(connectionId, ev.type, payloadWithSeq);
        }
        wsServer.sendTo(connectionId, "chat:resumed", {
          sessionId: p.sessionId,
          currentSeq: result.currentSeq,
          replayedCount: result.events.length,
        });
        break;
      }

      case "state_change": {
        const to = (message.payload as { to?: string })?.to;
        if (to === undefined) break;

        const canChange = stateMachine.canTransition(to as Parameters<typeof stateMachine.canTransition>[0]);
        if (canChange) {
          const from = stateMachine.getState();
          stateMachine.transition(to as Parameters<typeof stateMachine.transition>[0]);
          const transition: StateTransition = {
            from,
            to: to as StateTransition["to"],
            timestamp: new Date().toISOString(),
          };
          wsServer.broadcast("state_changed", transition);
        }
        break;
      }

      case "reply_request": {
        // Human-in-the-loop: operator sends a direct reply to an entity.
        // Payload: { entityId, channel, content }
        const replyPayload = message.payload as {
          entityId?: string;
          channel?: string;
          content?: { type: string; text?: string };
        };

        const { entityId, channel: replyChannel, content: replyContent } = replyPayload;

        if (
          entityId === undefined ||
          replyChannel === undefined ||
          replyContent === undefined ||
          replyContent.type !== "text" ||
          typeof replyContent.text !== "string"
        ) {
          log.warn(`reply_request: invalid payload from ${connectionId}`);
          break;
        }

        // Resolve the channelUserId for this entity+channel pairing
        const replyEntity = await entityStore.getEntity(entityId);
        if (replyEntity === null) {
          log.warn(`reply_request: entity ${entityId} not found`);
          break;
        }

        const channelAccounts = await entityStore.getChannelAccounts(entityId);
        const account = channelAccounts.find((ca) => ca.channel === replyChannel);
        if (account === undefined) {
          log.warn(`reply_request: no channel account for entity ${entityId} on channel ${replyChannel}`);
          break;
        }

        outboundDispatcher.dispatch({
          channelId: replyChannel,
          channelUserId: account.channelUserId,
          entityId,
          content: { type: "text", text: replyContent.text },
        }).then(() => {
          log.info(`reply_request: dispatched reply to entity ${entityId} on ${replyChannel}`);
        }).catch((err: unknown) => {
          log.error(
            `reply_request: dispatch error: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        break;
      }

      case "chat:open": {
        // Multi-session: create or resume a chat session.
        // Payload: { sessionId?: string, context?: "general" | string (project path) }
        const openPayload = message.payload as { sessionId?: string; context?: string } | undefined;

        if (ownerEntityId === undefined) {
          wsServer.sendTo(connectionId, "chat:error", { error: "Owner not configured" });
          break;
        }

        const chatSessionId = openPayload?.sessionId ?? ulid();
        const chatContext = openPayload?.context ?? "general";
        const sessionKey = `${ownerEntityId}:web:${chatSessionId}`;

        // Track session context for plan approval lookups
        chatSessionContexts.set(chatSessionId, chatContext);

        // Check for persisted session on disk first
        const persisted = chatPersistence.load(chatSessionId);
        if (persisted !== null && persisted.messages.length > 0) {
          // Re-hydrate the in-flight tracker
          chatSessionData.set(chatSessionId, persisted);

          // Re-hydrate the agent session so LLM has full context (including images)
          const agentSession = agentSessionManager.getOrCreate(sessionKey, ownerEntityId, "web");
          if (agentSession.turns.length === 0) {
            for (const msg of persisted.messages) {
              if (msg.role === "user") {
                // Resolve stored image IDs back to ImageRef objects
                let imageRefs: import("./agent-session.js").ImageRef[] | undefined;
                if (msg.images?.length) {
                  imageRefs = msg.images
                    .map((imageId) => {
                      const blob = imageBlobStore.load(chatSessionId, imageId);
                      if (!blob) return null;
                      return { imageId, mediaType: blob.mediaType, estimatedTokens: 1600 };
                    })
                    .filter((r): r is import("./agent-session.js").ImageRef => r !== null);
                  if (imageRefs.length === 0) imageRefs = undefined;
                }
                agentSessionManager.addUserTurn(sessionKey, msg.content, "", imageRefs);
              } else if (msg.role === "assistant") {
                agentSessionManager.addAssistantTurn(sessionKey, msg.content, "");
              }
              // Skip role: "tool" — those are UI-only timeline entries, not LLM context.
            }
          }

          wsServer.sendTo(connectionId, "chat:opened", {
            sessionId: chatSessionId,
            context: persisted.context,
            contextLabel: persisted.contextLabel,
            messages: persisted.messages,
          });
          break;
        }

        // Retrieve existing in-memory session history (if resuming)
        const existingSession = agentSessionManager.get(sessionKey);
        const historyTurns = existingSession !== undefined
          ? existingSession.turns.map((t) => ({ role: t.role, content: t.content, timestamp: t.timestamp }))
          : [];

        // Initialize in-flight tracker
        const contextLabel = chatContext === "general"
          ? "General"
          : config.workspace?.projects?.find((p) => chatContext.startsWith(p))
            ? chatContext.split("/").pop() ?? "Project"
            : chatContext.split("/").pop() ?? "Project";
        const newSessionData = ChatPersistence.createSession(chatSessionId, chatContext, contextLabel);
        // Pre-populate with existing history turns
        let sessionData = newSessionData;
        for (const turn of historyTurns) {
          sessionData = ChatPersistence.appendMessage(sessionData, {
            role: turn.role as "user" | "assistant",
            content: turn.content as string,
            timestamp: turn.timestamp as string,
          });
        }
        chatSessionData.set(chatSessionId, sessionData);

        wsServer.sendTo(connectionId, "chat:opened", {
          sessionId: chatSessionId,
          context: chatContext,
          messages: historyTurns,
        });
        break;
      }

      case "chat:cancel": {
        // Cancel an in-flight agent invocation for a session.
        const cancelPayload = message.payload as { sessionId?: string } | undefined;
        const cancelSessionId = cancelPayload?.sessionId;
        if (cancelSessionId) {
          const controller = sessionAbortControllers.get(cancelSessionId);
          if (controller) {
            controller.abort();
            sessionAbortControllers.delete(cancelSessionId);
            wsServer.sendTo(connectionId, "chat:cancelled", { sessionId: cancelSessionId, timestamp: new Date().toISOString() });
            log.info(`agent invocation cancelled for session ${cancelSessionId}`);
          }
        }
        break;
      }

      case "chat:send": {
        // Multi-session: send a message to a specific session.
        // Payload: { sessionId, text, context, images?, documents? }
        const chatPayload = message.payload as {
          sessionId?: string;
          text?: string;
          context?: string;
          images?: Array<{ data: string; mediaType: string }>;
          documents?: Array<{ data: string; mediaType: string; name: string }>;
        } | undefined;
        const chatText = chatPayload?.text;
        const chatSessionId = chatPayload?.sessionId;
        const chatImages = chatPayload?.images ?? [];
        const chatDocuments = chatPayload?.documents ?? [];

        if (ownerEntityId === undefined) {
          wsServer.sendTo(connectionId, "chat:error", { error: "Owner not configured" });
          break;
        }

        const hasText = typeof chatText === "string" && chatText.trim().length > 0;
        const hasMedia = chatImages.length > 0 || chatDocuments.length > 0;
        if (!hasText && !hasMedia) {
          wsServer.sendTo(connectionId, "chat:error", { error: "Empty message" });
          break;
        }

        // Build content: multi-block when images/documents present, plain string otherwise.
        let chatContent: unknown;
        if (hasMedia) {
          const blocks: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];
          for (const img of chatImages) {
            blocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mediaType,
                data: img.data.replace(/^data:[^;]+;base64,/, ""),
              },
            });
          }
          for (const doc of chatDocuments) {
            blocks.push({
              type: "document",
              source: {
                type: "base64",
                media_type: doc.mediaType,
                data: doc.data.replace(/^data:[^;]+;base64,/, ""),
              },
            });
          }
          if (hasText) {
            blocks.push({ type: "text", text: chatText });
          }
          chatContent = blocks;
        } else {
          chatContent = chatText;
        }

        const chatEntity = await entityStore.getEntity(ownerEntityId);
        if (chatEntity === null) {
          wsServer.sendTo(connectionId, "chat:error", { error: "Owner entity not found" });
          break;
        }

        // Build session key: scoped if sessionId provided, otherwise legacy single-session
        const sessionKey = chatSessionId
          ? `${ownerEntityId}:web:${chatSessionId}`
          : undefined;

        // Generate a runId to link all messages from this invocation.
        const runId = ulid();
        // `currentRunId` is the runId the chat event handlers should stamp on emitted
        // events. It starts equal to `runId`, but the post-run injection drain mutates
        // it so each follow-up run's events carry their own injRunId (the previous
        // closure-capture bug sent events with the outer runId and corrupted the run
        // grouping on the client).
        let currentRunId: string = runId;

        wsServer.sendTo(connectionId, "chat:thinking", {
          sessionId: chatSessionId,
          runId,
          timestamp: new Date().toISOString(),
        });

        // Save images to blob store and build image refs for the session pipeline
        const chatImageIds: string[] = [];
        const chatImageRefs: import("./agent-session.js").ImageRef[] = [];
        if (chatSessionId) {
          for (const img of chatImages) {
            const imageId = ulid();
            const base64 = img.data.replace(/^data:[^;]+;base64,/, "");
            imageBlobStore.save(chatSessionId, imageId, img.mediaType, base64);
            chatImageIds.push(imageId);
            // Estimate tokens: ~1600 per 200KB of base64
            const bytes = base64.length * 0.75;
            const tiles = Math.max(1, Math.ceil(bytes / 200_000));
            chatImageRefs.push({ imageId, mediaType: img.mediaType, estimatedTokens: tiles * 1600 });
          }
        }

        // Track user message for persistence (with image IDs)
        if (chatSessionId) {
          const existing = chatSessionData.get(chatSessionId);
          if (existing) {
            chatSessionData.set(chatSessionId, ChatPersistence.appendMessage(existing, {
              role: "user",
              content: typeof chatText === "string" ? chatText : "[media]",
              timestamp: new Date().toISOString(),
              runId,
              images: chatImageIds.length > 0 ? chatImageIds : undefined,
            }));
          }
        }

        const chatCoaFingerprint = await coaLogger.log({
          resourceId,
          entityId: ownerEntityId,
          entityAlias: chatEntity.coaAlias,
          nodeId,
          workType: "action",
        });

        // Derive project path from context (non-"general" context is a project path).
        // Special contexts:
        // "builder:create/update/review" — BuilderChat mode
        // "mapp:{id}" — MApp context (chat about a specific MApp)
        const chatContextRaw = chatPayload?.context ?? "general";
        const isBuilderMode = chatContextRaw.startsWith("builder:");
        const isMappContext = chatContextRaw.startsWith("mapp:");
        const builderMode = isBuilderMode ? chatContextRaw.split(":")[1] as "create" | "update" | "review" : undefined;
        let chatProjectPath = (!isBuilderMode && !isMappContext && chatContextRaw !== "general") ? chatContextRaw : undefined;

        // Emit invocation_start to project activity indicators.
        if (chatProjectPath !== undefined) {
          dashboardBroadcasterRef?.emitProjectActivity({
            projectPath: chatProjectPath,
            type: "invocation_start",
            summary: "Processing chat message...",
          });
        }

        // Local alias: every chat:* emit during this chat:send lifecycle goes
        // through the ring buffer so it's replayable on reconnect. This is the
        // ONLY difference from wsServer.sendTo — the buffer injects a seq field
        // into the payload and records it for later replay by chat:resume.
        const sendChat = (type: string, payload: Record<string, unknown>): void => {
          recordAndSendChat(chatSessionId, getConnId(), type, payload);
        };

        // Progressive chat update listeners
        const toolActivityMap: Record<string, string> = {
          manage_project: "Updating project...",
          shell_exec: "Running commands...",
          dir_list: "Browsing files...",
        };
        const toolStartHandler = (data: { sessionKey: string; toolName: string; toolIndex: number; loopIteration: number; toolInput?: Record<string, unknown> }) => {
          if (data.sessionKey !== sessionKey) return;
          sendChat("chat:tool_start", {
            sessionId: chatSessionId,
            runId: currentRunId,
            toolName: data.toolName,
            toolIndex: data.toolIndex,
            loopIteration: data.loopIteration,
            toolInput: data.toolInput,
            timestamp: new Date().toISOString(),
          });
          // Emit live tool activity to project card indicator
          if (chatProjectPath !== undefined) {
            dashboardBroadcasterRef?.emitProjectActivity({
              projectPath: chatProjectPath,
              type: "tool_used",
              summary: toolActivityMap[data.toolName] ?? "Working...",
            });
          }
        };
        const toolResultHandler = (data: { sessionKey: string; toolName: string; toolIndex: number; loopIteration: number; success: boolean; summary: string; resultContent?: string; detail?: Record<string, unknown>; toolInput?: Record<string, unknown> }) => {
          if (data.sessionKey !== sessionKey) return;
          const toolResultTs = new Date().toISOString();
          const toolCardId = `${chatSessionId ?? "t"}-${String(data.loopIteration)}-${String(data.toolIndex)}`;
          sendChat("chat:tool_result", {
            sessionId: chatSessionId,
            runId: currentRunId,
            toolName: data.toolName,
            toolIndex: data.toolIndex,
            loopIteration: data.loopIteration,
            success: data.success,
            summary: data.summary,
            detail: data.detail,
            timestamp: toolResultTs,
          });

          // Persist a role:"tool" message for this tool call
          if (chatSessionId) {
            const sd = chatSessionData.get(chatSessionId);
            if (sd) {
              chatSessionData.set(chatSessionId, ChatPersistence.appendMessage(sd, {
                role: "tool",
                content: data.summary ?? data.toolName,
                timestamp: toolResultTs,
                runId: currentRunId,
                toolCard: {
                  id: toolCardId,
                  toolName: data.toolName,
                  loopIteration: data.loopIteration,
                  toolIndex: data.toolIndex,
                  status: data.success ? "complete" : "error",
                  summary: data.summary,
                  toolInput: data.toolInput,
                  detail: data.detail,
                  timestamp: toolResultTs,
                  completedAt: toolResultTs,
                },
              }));
            }
          }

          // Context upgrade: when a general session creates a project, lock context to it.
          if (chatProjectPath === undefined && data.toolName === "manage_project" && data.resultContent) {
            try {
              const parsed = JSON.parse(data.resultContent) as { ok?: boolean; path?: string; name?: string; slug?: string };
              if (parsed.ok && parsed.path) {
                chatProjectPath = parsed.path;
                sendChat("chat:context_set", {
                  sessionId: chatSessionId,
                  context: parsed.path,
                  contextLabel: parsed.name ?? parsed.slug ?? "Project",
                });
                // Update persisted session context
                if (chatSessionId) {
                  const sd = chatSessionData.get(chatSessionId);
                  if (sd) {
                    sd.context = parsed.path;
                    sd.contextLabel = parsed.name ?? parsed.slug ?? "Project";
                  }
                }
              }
            } catch { /* not a create result — ignore */ }
          }
        };
        const progressHandler = (data: { sessionKey: string; text: string; phase: string }) => {
          if (data.sessionKey !== sessionKey) return;
          sendChat("chat:progress", {
            sessionId: chatSessionId,
            text: data.text,
            phase: data.phase,
            timestamp: new Date().toISOString(),
          });
        };
        const thoughtHandler = (data: { sessionKey: string; content: string }) => {
          if (data.sessionKey !== sessionKey) return;
          const thoughtTs = new Date().toISOString();
          sendChat("chat:thought", {
            sessionId: chatSessionId,
            runId: currentRunId,
            content: data.content,
            timestamp: thoughtTs,
          });
          // Persist as role:"thought" message
          if (chatSessionId) {
            const sd = chatSessionData.get(chatSessionId);
            if (sd) {
              chatSessionData.set(chatSessionId, ChatPersistence.appendMessage(sd, {
                role: "thought",
                content: data.content,
                timestamp: thoughtTs,
                runId: currentRunId,
              }));
            }
          }
        };
        const injectionConsumedHandler = (data: { sessionKey: string; count: number }) => {
          if (data.sessionKey !== sessionKey) return;
          sendChat("chat:injection_consumed", {
            sessionId: chatSessionId,
            count: data.count,
          });
        };

        // Use a getter that always resolves the CURRENT connectionId for this owner,
        // not the one captured at message-send time. This prevents stale connections
        // when the browser reconnects during long tool executions (Playwright, etc.).
        const getConnId = () => ownerConnectionMap.get(ownerEntityId!) ?? connectionId;

        agentInvoker.on("tool_start", toolStartHandler);
        agentInvoker.on("tool_result", toolResultHandler);
        agentInvoker.on("progress", progressHandler);
        agentInvoker.on("thought", thoughtHandler);
        agentInvoker.on("injection_consumed", injectionConsumedHandler);

        const removeProgressListeners = () => {
          agentInvoker.removeListener("tool_start", toolStartHandler);
          agentInvoker.removeListener("tool_result", toolResultHandler);
          agentInvoker.removeListener("progress", progressHandler);
          agentInvoker.removeListener("thought", thoughtHandler);
          agentInvoker.removeListener("injection_consumed", injectionConsumedHandler);
        };

        const chainKey = sessionKey ?? `${ownerEntityId}:web:default`;
        // Create abort controller for this invocation (cancellable via chat:cancel)
        const abortController = new AbortController();
        if (chatSessionId) sessionAbortControllers.set(chatSessionId, abortController);

        const prev = sessionProcessingChain.get(chainKey) ?? Promise.resolve();
        const current = prev.then(async () => {
          return agentInvoker.process({
            entity: chatEntity,
            channel: "web",
            content: chatContent,
            coaFingerprint: chatCoaFingerprint,
            queueMessageId: ulid(),
            isOwner: true,
            sessionKey,
            projectContext: chatProjectPath,
            builderMode,
            imageRefs: chatImageRefs.length > 0 ? chatImageRefs : undefined,
            chatSessionId,
            abortSignal: abortController.signal,
          });
        }).then(async (outcome) => {
          // Listeners stay attached through the post-run drain below — final detach
          // happens in the .finally() after drain completes. Removing them here
          // (as the old code did) silenced tool/thought events for injection follow-ups.
          if (chatSessionId) sessionAbortControllers.delete(chatSessionId);
          // Emit invocation_complete to clear the project activity indicator.
          if (chatProjectPath !== undefined) {
            dashboardBroadcasterRef?.emitProjectActivity({
              projectPath: chatProjectPath,
              type: "invocation_complete",
              summary: "Completed",
            });
          }
          if (outcome.type === "response") {
            let text = outcome.text;
            if (!text && outcome.toolsUsed.length > 0) {
              const toolPhraseMap: Record<string, string> = {
                manage_project: "updated project settings",
                shell_exec: "ran shell commands",
                dir_list: "browsed project files",
              };
              const phrases = [...new Set(
                outcome.toolsUsed.map((t) => toolPhraseMap[t] ?? "performed background actions"),
              )];
              const joined = phrases.length > 1
                ? `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]!}`
                : phrases[0]!;
              text = `Done \u2014 ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
            } else if (!text) {
              text = "[No response]";
            }
            // Generate next-step suggestions before emitting so they can
            // ride on the chat:response payload AND get persisted onto the
            // assistant message. Previously they lived only in ephemeral
            // client state and vanished on page reload.
            const suggestions = await generateNextSteps(chatText ?? "", text, getLLMProvider());

            // Record usage (tokens + cost + project attribution) BEFORE
            // emitting chat:response so the cost is available for the payload.
            let chatUsageRec: { costUsd: number } | undefined;
            if (outcome.usage && outcome.model) {
              try {
                chatUsageRec = await usageStore.record({
                  entityId: ownerEntityId,
                  projectPath: chatProjectPath,
                  provider: outcome.provider ?? "unknown",
                  model: outcome.model,
                  inputTokens: outcome.usage.inputTokens,
                  outputTokens: outcome.usage.outputTokens,
                  coaFingerprint: outcome.coaFingerprint,
                  toolCount: outcome.toolCount ?? 0,
                  loopCount: outcome.loopCount ?? 0,
                  source: "chat",
                  costMode: outcome.routingMeta?.costMode,
                  escalated: outcome.routingMeta?.escalated,
                  originalModel: outcome.routingMeta?.escalated ? outcome.routingMeta?.reason : undefined,
                });
                dashboardBroadcasterRef?.emitUsageRecorded({
                  source: "chat",
                  projectPath: chatProjectPath ?? "",
                  costUsd: chatUsageRec.costUsd,
                });

                // Phase 5: post-completion provider balance check
                // Calls the provider plugin's checkBalance() to get actual
                // remaining credit from the provider's API — NOT local spend.
                if (chatUsageRec.costUsd > 0 && outcome.provider) {
                  const providerDef = pluginRegistry.getProvider(outcome.provider);
                  if (providerDef?.checkBalance) {
                    const providerConfig = ((config.providers ?? {}) as Record<string, Record<string, unknown>>)[outcome.provider] ?? {};
                    const threshold = providerConfig.balanceAlertThreshold as number | undefined;
                    if (threshold !== undefined) {
                      try {
                        const balance = await providerDef.checkBalance(providerConfig);
                        if (balance !== null) {
                          // Record balance history for sparklines
                          void usageStore.recordBalance(outcome.provider, balance);
                        }
                        if (balance !== null && balance <= threshold) {
                          dashboardBroadcasterRef?.emitNotification({
                            id: `balance-alert-${Date.now()}`,
                            type: balance <= 0 ? "error" : "warning",
                            title: `Low balance: ${providerDef.name}`,
                            body: `Balance is $${balance.toFixed(2)}, threshold is $${threshold.toFixed(2)}`,
                            metadata: { provider: outcome.provider, balance, threshold },
                            createdAt: new Date().toISOString(),
                          });
                          // Auto-pause the provider when balance hits zero so the
                          // router falls back to alternatives automatically.
                          if (balance <= 0 && llmProvider instanceof AgentRouter) {
                            llmProvider.disableProvider(outcome.provider);
                          }
                        }
                      } catch { /* balance check is non-fatal */ }
                    }
                  }
                }
              } catch (usageErr) {
                log.warn(`usage recording failed: ${usageErr instanceof Error ? usageErr.message : String(usageErr)}`);
              }
            }

            // Build routing metadata for the response payload so the dashboard
            // can display which model handled the request and its estimated cost.
            const responseRoutingMeta = outcome.routingMeta
              ? {
                  provider: outcome.routingMeta.selectedProvider ?? outcome.provider ?? "unknown",
                  model: outcome.routingMeta.selectedModel ?? outcome.model ?? "unknown",
                  costMode: outcome.routingMeta.costMode ?? "unknown",
                  escalated: outcome.routingMeta.escalated ?? false,
                  estimatedCostUsd: chatUsageRec?.costUsd ?? 0,
                  requestType: outcome.routingMeta.requestType,
                  classifierUsed: outcome.routingMeta.classifierUsed,
                  contextLayers: outcome.routingMeta.contextLayers,
                  tokenBreakdown: outcome.routingMeta.tokenBreakdown,
                }
              : undefined;

            const responseTimestamp = new Date().toISOString();
            sendChat("chat:response", {
              sessionId: chatSessionId,
              runId,
              text,
              timestamp: responseTimestamp,
              suggestions,
              routingMeta: responseRoutingMeta,
            });
            // Keep emitting the legacy chat:suggestions frame for backwards
            // compatibility with any client that still listens for it
            // separately. No-op once the client reads from chat:response.
            if (suggestions.length > 0) {
              sendChat("chat:suggestions", {
                sessionId: chatSessionId,
                suggestions,
              });
            }

            // Persist session to disk — include suggestions and routing
            // metadata on the assistant message so they survive reload.
            if (chatSessionId) {
              const existing = chatSessionData.get(chatSessionId);
              if (existing) {
                const updated = ChatPersistence.appendMessage(existing, {
                  role: "assistant",
                  content: text,
                  timestamp: responseTimestamp,
                  runId,
                  suggestions: suggestions.length > 0 ? suggestions : undefined,
                  routingMeta: responseRoutingMeta,
                });
                chatSessionData.set(chatSessionId, updated);
                try { chatPersistence.save(updated); } catch { /* non-fatal */ }
              }
            }
          } else if (outcome.type === "error") {
            sendChat("chat:error", { sessionId: chatSessionId, error: outcome.message });
          } else if (outcome.type === "rate_limited") {
            sendChat("chat:error", { sessionId: chatSessionId, error: outcome.entityNotification });
          } else if (outcome.type === "queued") {
            sendChat("chat:response", {
              sessionId: chatSessionId,
              text: outcome.entityNotification || "[Message queued]",
              timestamp: new Date().toISOString(),
            });
          } else if (outcome.type === "human_routed") {
            sendChat("chat:response", {
              sessionId: chatSessionId,
              text: "[Routed to human operator]",
              timestamp: new Date().toISOString(),
            });
          } else if (outcome.type === "log_only") {
            sendChat("chat:response", {
              sessionId: chatSessionId,
              text: "[Logged — no response in current state]",
              timestamp: new Date().toISOString(),
            });
          }

          // Drain any remaining injected messages that weren't consumed during the
          // tool loop (e.g. when the agent responded with text only, no tools).
          // Re-invoke the agent for each so the frontend's pending counter clears.
          // Each follow-up run reassigns `currentRunId` so the still-attached event
          // handlers stamp events with the correct runId (prior closure-capture bug).
          if (sessionKey) {
            const remaining = agentInvoker.drainInjections(sessionKey);
            for (const injText of remaining) {
              const injRunId = ulid();
              currentRunId = injRunId;
              sendChat("chat:thinking", {
                sessionId: chatSessionId,
                runId: injRunId,
                timestamp: new Date().toISOString(),
              });
              // Persist the injected user message
              if (chatSessionId) {
                const sd = chatSessionData.get(chatSessionId);
                if (sd) {
                  chatSessionData.set(chatSessionId, ChatPersistence.appendMessage(sd, {
                    role: "user",
                    content: injText,
                    timestamp: new Date().toISOString(),
                    runId: injRunId,
                  }));
                }
              }
              try {
                const injOutcome = await agentInvoker.process({
                  entity: chatEntity,
                  channel: "web",
                  content: injText,
                  coaFingerprint: chatCoaFingerprint,
                  queueMessageId: ulid(),
                  isOwner: true,
                  sessionKey,
                  projectContext: chatProjectPath,
                });
                if (injOutcome.type === "response") {
                  const injResponseText = injOutcome.text || "[No response]";
                  sendChat("chat:response", {
                    sessionId: chatSessionId,
                    runId: injRunId,
                    text: injResponseText,
                    timestamp: new Date().toISOString(),
                  });
                  if (chatSessionId) {
                    const sd = chatSessionData.get(chatSessionId);
                    if (sd) {
                      const updated = ChatPersistence.appendMessage(sd, {
                        role: "assistant",
                        content: injResponseText,
                        timestamp: new Date().toISOString(),
                        runId: injRunId,
                      });
                      chatSessionData.set(chatSessionId, updated);
                      try { chatPersistence.save(updated); } catch { /* non-fatal */ }
                    }
                  }
                } else if (injOutcome.type === "error") {
                  sendChat("chat:error", { sessionId: chatSessionId, error: injOutcome.message });
                } else if (injOutcome.type === "rate_limited") {
                  sendChat("chat:error", { sessionId: chatSessionId, error: injOutcome.entityNotification });
                } else {
                  // Default: any other outcome type (queued, human_routed, log_only) — emit
                  // a chat:response so the client's thinking state ALWAYS clears. Without
                  // this default the UI sticks on "thinking..." forever.
                  sendChat("chat:response", {
                    sessionId: chatSessionId,
                    runId: injRunId,
                    text: "[Follow-up processed]",
                    timestamp: new Date().toISOString(),
                  });
                }
              } catch (injErr: unknown) {
                log.error(`chat:inject follow-up error: ${injErr instanceof Error ? injErr.message : String(injErr)}`);
                sendChat("chat:error", {
                  sessionId: chatSessionId,
                  error: injErr instanceof Error ? injErr.message : "Follow-up processing failed",
                });
              }
            }
          }
        }).catch((err: unknown) => {
          // Emit invocation_complete even on error so the indicator doesn't get stuck.
          if (chatProjectPath !== undefined) {
            dashboardBroadcasterRef?.emitProjectActivity({
              projectPath: chatProjectPath,
              type: "invocation_complete",
              summary: "Completed",
            });
          }
          log.error(`chat:send error: ${err instanceof Error ? err.message : String(err)}`);
          sendChat("chat:error", {
            sessionId: chatSessionId,
            error: err instanceof Error ? err.message : "Agent processing failed",
          });
        }).finally(() => {
          // Always detach listeners regardless of success/failure — previously only the
          // catch branch did this, leaking handlers across every chat:send on the same WS.
          removeProgressListeners();
          if (sessionProcessingChain.get(chainKey) === current) {
            sessionProcessingChain.delete(chainKey);
          }
        }) as Promise<void>;
        sessionProcessingChain.set(chainKey, current);
        break;
      }

      case "chat:close": {
        // Close a chat session and drop its replay buffer. The session itself
        // stays in memory for history recall; we just release the event ring.
        const closePayload = message.payload as { sessionId?: string } | undefined;
        if (closePayload?.sessionId) {
          chatEventBuffer.drop(closePayload.sessionId);
        }
        wsServer.sendTo(connectionId, "chat:closed", { sessionId: closePayload?.sessionId });
        break;
      }

      case "chat:inject": {
        // Inject a user message into an active agent loop (mid-loop injection).
        const injectPayload = message.payload as { sessionId?: string; text?: string } | undefined;
        const injectSessionId = injectPayload?.sessionId;
        const injectText = injectPayload?.text;

        if (!injectSessionId || !injectText || typeof injectText !== "string" || injectText.trim().length === 0) {
          wsServer.sendTo(connectionId, "chat:error", { sessionId: injectSessionId, error: "Invalid inject payload" });
          break;
        }

        if (ownerEntityId === undefined) {
          wsServer.sendTo(connectionId, "chat:error", { sessionId: injectSessionId, error: "Owner not configured" });
          break;
        }

        const injectSessionKey = `${ownerEntityId}:web:${injectSessionId}`;
        agentInvoker.injectMessage(injectSessionKey, injectText);
        wsServer.sendTo(connectionId, "chat:inject_ack", { sessionId: injectSessionId });

        // Persist as user message
        if (injectSessionId) {
          const sd = chatSessionData.get(injectSessionId);
          if (sd) {
            chatSessionData.set(injectSessionId, ChatPersistence.appendMessage(sd, {
              role: "user",
              content: injectText,
              timestamp: new Date().toISOString(),
            }));
          }
        }
        break;
      }

      case "chat:plan_approve": {
        // Approve a plan and trigger Tynn sync if the project has a Tynn token.
        const approvePayload = message.payload as {
          planId?: string;
          projectPath?: string;
          sessionId?: string;
        } | undefined;

        const planId = approvePayload?.planId;
        const approveProjectPath = approvePayload?.projectPath;
        const approveSessionId = approvePayload?.sessionId;

        if (typeof planId !== "string" || planId.length === 0) {
          wsServer.sendTo(connectionId, "chat:error", {
            sessionId: approveSessionId,
            error: "planId is required",
          });
          break;
        }

        // Derive projectPath from session context if not provided
        const effectiveProjectPath = approveProjectPath
          ?? (approveSessionId ? chatSessionContexts.get(approveSessionId) : undefined);

        if (typeof effectiveProjectPath !== "string" || effectiveProjectPath.length === 0) {
          wsServer.sendTo(connectionId, "chat:error", {
            sessionId: approveSessionId,
            error: "projectPath is required",
          });
          break;
        }

        // Load and approve the plan
        const approvedPlan = planStore.update(effectiveProjectPath, planId, { status: "approved" });
        if (approvedPlan === null) {
          wsServer.sendTo(connectionId, "chat:error", {
            sessionId: approveSessionId,
            error: `Plan ${planId} not found`,
          });
          break;
        }

        // Broadcast plan status change
        wsServer.broadcast("chat:plan_status", {
          planId: approvedPlan.id,
          projectPath: effectiveProjectPath,
          status: "approved",
          sessionId: approveSessionId,
          timestamp: new Date().toISOString(),
        });

        // Check if the project has a Tynn token
        let tynnToken: string | null = null;
        try {
          const metaPath = projectConfigPath(effectiveProjectPath);
          const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { tynnToken?: string };
          tynnToken = meta.tynnToken ?? null;
        } catch {
          // No metadata file or malformed — no Tynn token
        }

        if (tynnToken !== null && ownerEntityId !== undefined) {
          // Generate the Tynn sync prompt
          const syncResult = buildTynnSyncPrompt({
            id: approvedPlan.id,
            title: approvedPlan.title,
            steps: approvedPlan.steps,
            body: approvedPlan.body,
            projectPath: approvedPlan.projectPath,
          });

          // Trigger a background agent invocation with the sync prompt
          const syncEntity = await entityStore.getEntity(ownerEntityId);
          if (syncEntity !== null) {
            const syncCoaFingerprint = await coaLogger.log({
              resourceId,
              entityId: ownerEntityId,
              entityAlias: syncEntity.coaAlias,
              nodeId,
              workType: "action",
            });

            agentInvoker.process({
              entity: syncEntity,
              channel: "web",
              content: syncResult.prompt,
              coaFingerprint: syncCoaFingerprint,
              queueMessageId: ulid(),
              isOwner: true,
              sessionKey: approveSessionId ? `${ownerEntityId}:web:${approveSessionId}` : undefined,
              projectContext: effectiveProjectPath,
            }).then((outcome) => {
              if (outcome.type === "response" && outcome.text) {
                // Try to parse Tynn refs from the agent response
                try {
                  const jsonMatch = /\{[^{}]*"versionId"[^{}]*"storyIds"[^{}]*"taskIds"[^{}]*\}/.exec(outcome.text);
                  if (jsonMatch !== null) {
                    const refs = JSON.parse(jsonMatch[0]) as {
                      versionId: string | null;
                      storyIds: string[];
                      taskIds: string[];
                    };
                    planStore.update(effectiveProjectPath, planId, { tynnRefs: refs });

                    wsServer.broadcast("chat:plan_status", {
                      planId,
                      projectPath: effectiveProjectPath,
                      status: "approved",
                      tynnRefs: refs,
                      sessionId: approveSessionId,
                      timestamp: new Date().toISOString(),
                    });
                  }
                } catch {
                  log.warn(`chat:plan_approve: could not parse Tynn refs from agent response`);
                }

                wsServer.sendTo(connectionId, "chat:response", {
                  sessionId: approveSessionId,
                  text: outcome.text,
                  timestamp: new Date().toISOString(),
                });
              }
            }).catch((err: unknown) => {
              log.error(`chat:plan_approve Tynn sync error: ${err instanceof Error ? err.message : String(err)}`);
              wsServer.sendTo(connectionId, "chat:error", {
                sessionId: approveSessionId,
                error: "Tynn sync failed — plan is approved but items were not created",
              });
            });
          }
        }

        break;
      }

      case "chat:history": {
        // Legacy: single-session history (backward compatible)
        if (ownerEntityId === undefined) {
          wsServer.sendTo(connectionId, "chat:history", { messages: [] });
          break;
        }

        const session = agentSessionManager.get(ownerEntityId);
        const historyMessages = session !== undefined
          ? session.turns.map((t) => ({ role: t.role, content: t.content, timestamp: t.timestamp }))
          : [];

        wsServer.sendTo(connectionId, "chat:history", { messages: historyMessages });
        break;
      }

      case "log:subscribe": {
        logSubscribers.add(connectionId);

        // Send recent history from activity.log — must match the logger's
        // default path (logger.ts uses ~/.agi/logs/, not ./logs/).
        const logDir = (config.logging as { logDir?: string } | undefined)?.logDir ?? join(homedir(), ".agi", "logs");
        const activityLogPath = resolvePath(logDir, "activity.log");
        try {
          const raw = readFileSync(activityLogPath, "utf-8");
          const lines = raw.trimEnd().split("\n");
          const recent = lines.slice(-1000);
          const history: LogEntry[] = [];
          for (const line of recent) {
            const match = /^(\S+)\s+\[(\w+)\s*\]\s+\[([^\]]+)\]\s+(.*)$/.exec(line);
            if (match) {
              history.push({
                timestamp: match[1]!,
                level: match[2]!.toLowerCase() as LogEntry["level"],
                component: match[3]!,
                message: match[4]!,
              });
            }
          }
          wsServer.sendTo(connectionId, "log:history", history);
        } catch {
          // Log file may not exist yet
          wsServer.sendTo(connectionId, "log:history", []);
        }
        break;
      }

      case "log:unsubscribe": {
        logSubscribers.delete(connectionId);
        break;
      }

      // -----------------------------------------------------------------------
      // Terminal session management
      // -----------------------------------------------------------------------

      case "terminal:open": {
        const termPayload = message.payload as { projectPath?: string; cols?: number; rows?: number } | undefined;
        // When the client sends no projectPath (or an empty one), treat this as a
        // system-level terminal and spawn in the user's home directory. This is the
        // path used by the main-header "System Terminal" button in the dashboard.
        const rawPath = termPayload?.projectPath;
        const isSystem = !(typeof rawPath === "string" && rawPath.length > 0);
        const termProjectPath = isSystem ? (process.env.HOME ?? "/") : rawPath!;
        const sessionId = `term_${ulid()}`;
        const termSession = terminalManager.open(sessionId, termProjectPath, termPayload?.cols ?? 80, termPayload?.rows ?? 24);
        if (termSession === null) {
          wsServer.sendTo(connectionId, "terminal:error", { error: "Terminal working directory not found" });
          break;
        }
        // Wire output to this WS connection
        const onData = (sid: string, data: string) => {
          if (sid === sessionId) {
            wsServer.sendTo(connectionId, "terminal:data", { sessionId, data });
          }
        };
        const onExit = (sid: string, code: number | null) => {
          if (sid === sessionId) {
            wsServer.sendTo(connectionId, "terminal:exited", { sessionId, code });
            terminalManager.removeListener("data", onData);
            terminalManager.removeListener("exit", onExit);
          }
        };
        terminalManager.on("data", onData);
        terminalManager.on("exit", onExit);
        wsServer.sendTo(connectionId, "terminal:opened", {
          sessionId,
          projectPath: termProjectPath,
          // Hint to the client whether this is a system terminal so it can pick the
          // right tab label. The label is computed client-side from this + projects.
          scope: isSystem ? "system" : "project",
        });
        break;
      }

      case "terminal:input": {
        const inputPayload = message.payload as { sessionId?: string; data?: string } | undefined;
        if (typeof inputPayload?.sessionId === "string" && typeof inputPayload.data === "string") {
          terminalManager.write(inputPayload.sessionId, inputPayload.data);
        }
        break;
      }

      case "terminal:resize": {
        const resizePayload = message.payload as { sessionId?: string; cols?: number; rows?: number } | undefined;
        if (typeof resizePayload?.sessionId === "string" && typeof resizePayload.cols === "number" && typeof resizePayload.rows === "number") {
          terminalManager.resize(resizePayload.sessionId, resizePayload.cols, resizePayload.rows);
        }
        break;
      }

      case "terminal:close": {
        const closeTermPayload = message.payload as { sessionId?: string } | undefined;
        if (typeof closeTermPayload?.sessionId === "string") {
          terminalManager.close(closeTermPayload.sessionId);
        }
        break;
      }

      // -----------------------------------------------------------------------
      // Container terminal session management
      // -----------------------------------------------------------------------

      case "container-terminal:open": {
        const ctPayload = message.payload as { projectPath?: string; cols?: number; rows?: number } | undefined;
        const ctProjectPath = ctPayload?.projectPath;
        if (typeof ctProjectPath !== "string" || ctProjectPath.length === 0) {
          wsServer.sendTo(connectionId, "container-terminal:error", { error: "projectPath required" });
          break;
        }

        // Resolve container name from hosting manager
        const ctHosted = hostingManager.getStatus().projects.find(
          (p: { path: string }) => p.path === ctProjectPath,
        );
        const ctContainerName = ctHosted?.containerName;
        if (!ctContainerName) {
          wsServer.sendTo(connectionId, "container-terminal:error", { error: "No running container for this project" });
          break;
        }

        const ctSessionId = `ct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ctSession = terminalManager.openInContainer(
          ctSessionId,
          ctContainerName,
          ctPayload?.cols ?? 80,
          ctPayload?.rows ?? 24,
        );
        if (!ctSession) {
          wsServer.sendTo(connectionId, "container-terminal:error", { error: "Failed to open container terminal" });
          break;
        }

        const ctOnData = (sid: string, data: string) => {
          if (sid === ctSessionId) wsServer.sendTo(connectionId, "container-terminal:data", { sessionId: sid, data });
        };
        const ctOnExit = (sid: string, code: number | null) => {
          if (sid === ctSessionId) {
            wsServer.sendTo(connectionId, "container-terminal:exited", { sessionId: sid, code });
            terminalManager.removeListener("data", ctOnData);
            terminalManager.removeListener("exit", ctOnExit);
          }
        };
        terminalManager.on("data", ctOnData);
        terminalManager.on("exit", ctOnExit);
        wsServer.sendTo(connectionId, "container-terminal:opened", { sessionId: ctSessionId, containerName: ctContainerName });
        break;
      }

      case "container-terminal:input": {
        const ctInputPayload = message.payload as { sessionId?: string; data?: string } | undefined;
        if (typeof ctInputPayload?.sessionId === "string" && typeof ctInputPayload.data === "string") {
          terminalManager.write(ctInputPayload.sessionId, ctInputPayload.data);
        }
        break;
      }

      case "container-terminal:resize": {
        const ctResizePayload = message.payload as { sessionId?: string; cols?: number; rows?: number } | undefined;
        if (typeof ctResizePayload?.sessionId === "string" && typeof ctResizePayload.cols === "number" && typeof ctResizePayload.rows === "number") {
          terminalManager.resize(ctResizePayload.sessionId, ctResizePayload.cols, ctResizePayload.rows);
        }
        break;
      }

      case "container-terminal:close": {
        const ctClosePayload = message.payload as { sessionId?: string } | undefined;
        if (typeof ctClosePayload?.sessionId === "string") {
          terminalManager.close(ctClosePayload.sessionId);
        }
        break;
      }

      default:
        // Unknown message type — ignore
        break;
    }
  })(); });

  wsServer.on("disconnection", (connectionId: string) => {
    subscriptions.delete(connectionId);
    logSubscribers.delete(connectionId);
  });

  // -------------------------------------------------------------------------
  // Step 7b: Channel status events → WS broadcast (Task 12)
  // -------------------------------------------------------------------------

  channelRegistry.on("channel_started", (channelId: string) => {
    wsServer.broadcast("channel_status", { channelId, status: "running", timestamp: new Date().toISOString() });
  });
  channelRegistry.on("channel_stopped", (channelId: string) => {
    wsServer.broadcast("channel_status", { channelId, status: "stopped", timestamp: new Date().toISOString() });
  });
  channelRegistry.on("channel_error", (channelId: string, error: string) => {
    wsServer.broadcast("channel_status", { channelId, status: "error", error, timestamp: new Date().toISOString() });
  });

  // -------------------------------------------------------------------------
  // Step 8: Sidecars startup
  // -------------------------------------------------------------------------

  const dashboardBroadcaster = config.dashboard?.enabled !== false
    ? new DashboardEventBroadcaster(
        { wss: wsServer },
        config.dashboard?.broadcastIntervalMs ?? 5000,
      )
    : null;

  // Populate the late-bound ref so the chat:send handler can emit project activity.
  dashboardBroadcasterRef = dashboardBroadcaster;

  /**
   * Autonomous Aion turn triggered by a TaskMaster completion/handoff event
   * on an idle session. Drains whatever's queued via injectMessage (the
   * note(s) plus any siblings), fires a minimal invocation, and broadcasts
   * the resulting response into the originating chat so the user sees it
   * land without having to message first.
   *
   * Light compared to the chat:send path: no image handling, no abort
   * controllers, no tool-activity progress events. Just "agent replies to
   * the system-injected note."
   */
  async function fireAutonomousTurnForTaskmaster(args: {
    sessionKey: string;
    chatSessionId?: string;
    projectPath: string;
  }): Promise<void> {
    if (ownerEntityId === undefined) return;
    const entity = await entityStore.getEntity(ownerEntityId);
    if (entity === null) return;

    // Drain injected notes for this session — the content of this autonomous
    // turn IS those notes, so swallowing them here prevents a double-drain
    // on the next user turn.
    const notes = agentInvoker.drainInjections(args.sessionKey);
    if (notes.length === 0) return;
    const content = notes.join("\n\n---\n\n");

    const coaFingerprint = await coaLogger.log({
      resourceId,
      entityId: entity.id,
      entityAlias: entity.coaAlias,
      nodeId,
      workType: "action",
    });

    const runId = ulid();
    const targetConnId = ownerConnectionMap.get(ownerEntityId);

    const emit = (type: string, payload: Record<string, unknown>): void => {
      if (targetConnId === undefined) return;
      recordAndSendChat(args.chatSessionId, targetConnId, type, payload);
    };

    emit("chat:thinking", {
      sessionId: args.chatSessionId,
      runId,
      timestamp: new Date().toISOString(),
    });

    // Persist the injection as a synthetic user turn so the chat transcript
    // shows what Aion is responding to on reload. Prefixed so the client can
    // style it differently if desired.
    if (args.chatSessionId !== undefined) {
      const existing = chatSessionData.get(args.chatSessionId);
      if (existing !== undefined) {
        chatSessionData.set(
          args.chatSessionId,
          ChatPersistence.appendMessage(existing, {
            role: "user",
            content,
            timestamp: new Date().toISOString(),
            runId,
          }),
        );
      }
    }

    const outcome = await agentInvoker.process({
      entity,
      channel: "web",
      content,
      coaFingerprint,
      queueMessageId: ulid(),
      isOwner: true,
      sessionKey: args.sessionKey,
      projectContext: args.projectPath.length > 0 ? args.projectPath : undefined,
      chatSessionId: args.chatSessionId,
    });

    if (outcome.type === "response") {
      const text = outcome.text || "[No response]";
      emit("chat:response", {
        sessionId: args.chatSessionId,
        runId,
        text,
        timestamp: new Date().toISOString(),
      });
      if (args.chatSessionId !== undefined) {
        const existing = chatSessionData.get(args.chatSessionId);
        if (existing !== undefined) {
          const updated = ChatPersistence.appendMessage(existing, {
            role: "assistant",
            content: text,
            timestamp: new Date().toISOString(),
            runId,
          });
          chatSessionData.set(args.chatSessionId, updated);
          try { chatPersistence.save(updated); } catch { /* non-fatal */ }
        }
      }
    }
  }

  // Inject worker-completion / handoff reports back into Aion's chat session.
  // Without this, a dispatched worker was fire-and-forget from Aion's
  // perspective — it had no way to notice the job finished.
  //
  // Two delivery paths:
  //   (a) If Aion is currently mid-turn on this session, queue the note via
  //       injectMessage — the active tool loop drains it naturally.
  //   (b) If the session is idle (no active invocation), fire an autonomous
  //       follow-up turn so Aion processes the note without waiting for the
  //       user to message. Without (b), the note sits in the queue forever.
  workerRuntime.on("runtime:event", (event: { type: string; jobId: string; [key: string]: unknown }) => { void (async () => {
    const origin = jobOriginBySessionKey.get(event.jobId);

    // Auto-advance the linked plan step regardless of session presence —
    // step status is a property of the plan, not the chat, so even
    // background/resumed jobs should mark progress. Runs BEFORE the
    // sessionKey guard so plan-only dispatches (no chat) still update.
    if (origin?.planRef !== undefined) {
      const stepStatus =
        event.type === "report_ready" ? "complete" :
        event.type === "job_failed" ? "failed" :
        null;
      if (stepStatus !== null) {
        try {
          planStore.update(origin.projectPath, origin.planRef.planId, {
            stepUpdates: [{ id: origin.planRef.stepId, status: stepStatus }],
          });
        } catch (err) {
          log.warn(`plan step auto-advance failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Record worker LLM usage so it shows up in the Usage section alongside
    // Aion's own token spend. Previously workers burned API credits silently.
    if (event.type === "report_ready" || event.type === "job_failed") {
      const tokens = event.tokens as { input: number; output: number } | undefined;
      if (tokens !== undefined && ownerEntityId !== undefined) {
        try {
          const workerUsageRec = await usageStore.record({
            entityId: ownerEntityId,
            projectPath: origin?.projectPath ?? "",
            provider: "anthropic",
            model: typeof event.model === "string" ? event.model : "worker",
            inputTokens: tokens.input,
            outputTokens: tokens.output,
            coaFingerprint: typeof event.coaReqId === "string" ? event.coaReqId : "",
            toolCount: Array.isArray(event.toolCalls) ? event.toolCalls.length : 0,
            source: "worker",
            loopCount: typeof event.toolLoops === "number" ? event.toolLoops : 0,
          });
          dashboardBroadcasterRef?.emitUsageRecorded({
            source: "worker",
            projectPath: origin?.projectPath ?? "",
            costUsd: workerUsageRec.costUsd,
          });
        } catch (err) {
          log.warn(`worker usage recording failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (!origin?.sessionKey) return;

    let note: string | null = null;
    if (event.type === "report_ready") {
      const gist = typeof event.gist === "string" ? event.gist : "(no gist)";
      note = `[taskmaster] Worker job \`${event.jobId}\` completed. Report:\n\n${gist}`;
    } else if (event.type === "job_failed") {
      const err = typeof event.error === "string" ? event.error : "(no detail)";
      note = `[taskmaster] Worker job \`${event.jobId}\` FAILED. Error: ${err}`;
    } else if (event.type === "worker_handoff") {
      const question = typeof event.question === "string" ? event.question : "(no question)";
      note = `[taskmaster] Worker job \`${event.jobId}\` raised a checkpoint:\n\n${question}\n\nThe worker has paused — decide how to answer and re-dispatch with clarification if needed.`;
    }
    if (note !== null) {
      try {
        agentInvoker.injectMessage(origin.sessionKey, note);
      } catch (err) {
        log.warn(`failed to inject worker event into session ${origin.sessionKey}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Path (b): session idle → fire an autonomous turn so Aion reads the
      // note now, not on the user's next message. Fire-and-forget; errors
      // are logged but don't propagate (this is a background flow).
      if (!agentInvoker.isBusy(origin.sessionKey)) {
        void fireAutonomousTurnForTaskmaster({
          sessionKey: origin.sessionKey,
          chatSessionId: origin.chatSessionId,
          projectPath: origin.projectPath,
        }).catch((err: unknown) => {
          log.warn(`autonomous taskmaster turn failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }
    // Terminal states free the map entry so we don't leak memory on long runs.
    if (event.type === "report_ready" || event.type === "job_failed") {
      jobOriginBySessionKey.delete(event.jobId);
    }
  })(); });

  // Wire worker runtime events to the dashboard broadcaster.
  if (dashboardBroadcaster !== null) {
    workerRuntime.on("runtime:event", (event: { type: string; jobId: string; [key: string]: unknown }) => {
      if (event.type === "job_started") {
        dashboardBroadcaster.emitTmJobUpdate({
          jobId: event.jobId,
          status: "running",
          description: String(event.description ?? ""),
          currentPhase: null,
          workers: (event.workers as string[]) ?? [],
        });
      } else if (event.type === "job_failed") {
        dashboardBroadcaster.emitTmJobUpdate({
          jobId: event.jobId,
          status: "failed",
          description: String(event.error ?? ""),
          currentPhase: null,
          workers: [],
        });
      } else if (event.type === "worker_done") {
        dashboardBroadcaster.emitTmJobUpdate({
          jobId: event.jobId,
          status: "running",
          description: `Worker ${String(event.worker ?? "")} completed`,
          currentPhase: String(event.phase ?? ""),
          workers: (event.workers as string[]) ?? [],
        });
      } else if (event.type === "phase_done") {
        dashboardBroadcaster.emitTmJobUpdate({
          jobId: event.jobId,
          status: "running",
          description: `Phase ${String(event.phase ?? "")} completed`,
          currentPhase: String(event.nextPhase ?? ""),
          workers: [],
        });
      } else if (event.type === "checkpoint") {
        dashboardBroadcaster.emitTmJobUpdate({
          jobId: event.jobId,
          status: "checkpoint",
          description: String(event.message ?? "Checkpoint reached — awaiting approval"),
          currentPhase: String(event.phase ?? ""),
          workers: [],
        });
      } else if (event.type === "report_ready") {
        dashboardBroadcaster.emitTmJobUpdate({
          jobId: event.jobId,
          status: "complete",
          description: String(event.gist ?? "Job completed"),
          currentPhase: null,
          workers: [],
        });
      } else if (event.type === "worker_handoff") {
        // A worker is asking Aion for a decision. Surface it as a checkpoint
        // on the Work Queue row; the chat transcript gets the same signal via
        // the chat session WS routing below.
        dashboardBroadcaster.emitTmJobUpdate({
          jobId: event.jobId,
          status: "checkpoint",
          description: `Worker handoff: ${String(event.question ?? "decision requested")}`,
          currentPhase: null,
          workers: [],
        });
      } else if (event.type === "worker_tool_call") {
        // Live tool-call trace — lets the UI animate a tool name under the
        // job row without a full status change.
        dashboardBroadcaster.emitTmJobUpdate({
          jobId: event.jobId,
          status: "running",
          description: `Tool: ${String(event.tool ?? "?")}`,
          currentPhase: null,
          workers: [],
        });
      }
    });
  }

  // Boot-time reconciliation — fires AFTER the runtime:event listeners above
  // are wired so `job_failed` events emitted during reconcile flow through
  // the same Work Queue + chat-injection paths as runtime completions.
  // Covers SIGKILL-on-restart zombies and crash-survivors alike.
  try {
    const reconciled = await workerRuntime.reconcileOrphanedJobs();
    if (reconciled > 0) {
      log.info(`taskmaster reconciliation: ${String(reconciled)} orphaned job(s) flipped to failed`);
    }
  } catch (err) {
    log.warn(`taskmaster reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let heartbeatScheduler: HeartbeatScheduler | null = null;
  if (config.heartbeat?.enabled) {
    heartbeatScheduler = new HeartbeatScheduler({
      intervalMs: config.heartbeat.intervalMs ?? 3600000,
      promptPath: config.heartbeat.promptPath ?? "./data/persona/HEARTBEAT.md",
      agentInvoker,
      entityStore,
      coaLogger,
      resourceId,
      nodeId,
      logger,
    });
    heartbeatScheduler.start();
    log.info(`heartbeat scheduler started (interval: ${String(config.heartbeat.intervalMs ?? 3600000)}ms)`);
  }

  const sidecarsResult = await startGatewaySidecars(
    {
      channelRegistry,
      inboundRouter,
      queueConsumer,
      agentSessionManager,
      sessionStore,
      dashboardBroadcaster,
      httpServer,
      entityStore,
      logger,
    },
    {
      channels: config.channels.map((ch: { id: string; enabled?: boolean; config?: Record<string, unknown> }) => ({
        id: ch.id,
        enabled: ch.enabled ?? true,
        config: ch.config,
      })),
      dashboardEnabled: config.dashboard?.enabled !== false,
    },
  );

  // -------------------------------------------------------------------------
  // Step 8b: Hosting initialization (after sidecars so Caddy/dnsmasq are running)
  // -------------------------------------------------------------------------

  if (hostingConfig?.enabled) {
    // Wire hosting status changes to dashboard broadcaster
    if (dashboardBroadcaster !== null) {
      hostingManager.setOnStatusChange(() => {
        dashboardBroadcaster.emitHostingStatus(hostingManager.getStatus());
      });

      // Wire project config changes → WS events for live dashboard
      projectConfigManager.on("changed", (event: { projectPath: string; changedKeys: string[] }) => {
        dashboardBroadcaster.emitProjectConfigChanged({
          projectPath: event.projectPath,
          changedKeys: event.changedKeys,
        });
        // Also push full hosting status so project list refreshes
        dashboardBroadcaster.emitHostingStatus(hostingManager.getStatus());
      });
    }
    await hostingManager.initialize();
    log.info("hosting manager initialized");

    // Initialize service manager (infrastructure services from plugins)
    await serviceManager.initialize();
  }

  // -------------------------------------------------------------------------
  // Step 8c: Scheduled task manager — plugin-registered cron/interval tasks
  // -------------------------------------------------------------------------

  const scheduledTaskManager = new ScheduledTaskManager({ pluginRegistry, logger });

  // Register core scheduled task: chat garbage collector
  const chatGC = new ChatGarbageCollector({ chatPersistence, imageBlobStore, configPath: opts?.configPath });
  pluginRegistry.addScheduledTask("core", {
    id: "chat-garbage-collector",
    name: "Chat Garbage Collector",
    description: "Prunes chat sessions older than retention period and removes orphaned image directories",
    cron: "0 2 * * *",
    handler: async () => {
      const stats = await chatGC.collect();
      log.info(`chat GC: scanned=${String(stats.sessionsScanned)} deleted=${String(stats.sessionsDeleted)} orphans=${String(stats.orphanedImageDirsDeleted)} duration=${String(stats.durationMs)}ms`);
    },
    skipIfRunning: true,
    enabled: true,
  });

  // Register core scheduled task: marketplace auto-sync
  const autoSyncEnabled = (config.gateway as { autoSyncMarketplace?: boolean } | undefined)?.autoSyncMarketplace !== false;
  pluginRegistry.addScheduledTask("core", {
    id: "marketplace-auto-sync",
    name: "Marketplace Auto-Sync",
    description: "Periodically syncs Plugin + MApp marketplace catalogs and auto-updates installed plugins",
    intervalMs: 30 * 60 * 1000, // 30 minutes
    handler: async () => {
      try {
        // Re-resolve the marketplace source each tick so Dev Mode toggles
        // take effect without a restart (tynn #250/#251). We read config
        // fresh from disk because gateway.json is hot-swappable.
        let liveConfig: Parameters<typeof resolveMarketplaceSource>[0] = config;
        try {
          const cfgPath = join(homedir(), ".agi", "gateway.json");
          if (existsSync(cfgPath)) {
            liveConfig = JSON.parse(readFileSync(cfgPath, "utf-8")) as typeof liveConfig;
          }
        } catch {
          // Fall back to the boot-time config snapshot
        }

        for (const [manager, kind, label] of [
          [marketplaceManager, "plugin" as const, "plugin"],
          [mappMarketplaceManager, "mapp" as const, "mapp"],
        ] as const) {
          const desiredRef = resolveMarketplaceSource(liveConfig, kind);
          const sources = manager.getSources();
          const current = sources[0];
          if (current && current.ref !== desiredRef) {
            manager.removeSource(current.id);
            manager.addSource(desiredRef, label === "plugin" ? "Aionima" : "Aionima MApps");
            log.info(`${label}-marketplace: source swapped (dev-mode toggle) → ${desiredRef}`);
          }
        }

        const result = await marketplaceManager.syncAndUpdateAll();
        if (result.updated.length > 0) {
          log.info(`marketplace auto-sync: updated ${result.updated.join(", ")}`);
        }
      } catch (err) {
        log.warn(`marketplace auto-sync failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    skipIfRunning: true,
    enabled: autoSyncEnabled,
  });

  scheduledTaskManager.start();

  // -------------------------------------------------------------------------
  // Step 9: Log startup summary and return handle
  // -------------------------------------------------------------------------

  // Show deployed commit in startup banner (if marker exists)
  let deployedCommit = "";
  try {
    const { readFileSync } = await import("node:fs");
    deployedCommit = readFileSync(".deployed-commit", "utf-8").trim().slice(0, 7);
  } catch { /* no marker — first run or dev mode */ }

  log.info(`aionima gateway listening on ${host}:${String(port)}${deployedCommit ? ` (${deployedCommit})` : ""}`);
  log.info(`state: ${stateMachine.getState()}`);
  log.info(`channels started: ${sidecarsResult.channelsStarted.join(", ") || "none"}`);
  if (sidecarsResult.channelsSkipped.length > 0) {
    log.info(`channels skipped: ${sidecarsResult.channelsSkipped.join(", ")}`);
  }

  // -------------------------------------------------------------------------
  // Step 9b: Config hot-reload (Story 9, Tasks 20-21)
  // -------------------------------------------------------------------------

  let configWatcher: ConfigWatcher | null = null;

  if (opts?.configPath !== undefined) {
    configWatcher = new ConfigWatcher({
      configPath: opts.configPath,
      debounceMs: 500,
    });

    configWatcher.on("reload", (event: ConfigReloadEvent) => {
      log.info(`config reloaded — changed: ${event.changedKeys.join(", ")}`);

      // Update the in-memory config object so plugins see fresh values via getConfig()
      const freshConfig = event.config as Record<string, unknown>;
      const configObj = config as Record<string, unknown>;
      for (const key of Object.keys(configObj)) {
        if (!(key in freshConfig)) delete configObj[key];
      }
      Object.assign(configObj, freshConfig);

      // Hot-swap LLM provider when agent config changes
      if (event.changedKeys.some((k) => k === "agent")) {
        try {
          llmProvider = createAgentRouter(event.config, logger);
          wireProviderErrorCallback(llmProvider);
          wireCostLedger(llmProvider);
          log.info("LLM provider hot-swapped");
        } catch (err) {
          log.error(`failed to hot-swap LLM provider: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Hot-swap worker runtime config (autoApprove, concurrency, timeout, model map)
      if (event.changedKeys.some((k) => k === "workers" || k === "agent")) {
        try {
          const fc = freshConfig as { workers?: { autoApprove?: boolean; maxConcurrentJobs?: number; workerTimeoutMs?: number }; agent?: { model?: string } };
          workerRuntime.reloadConfig({
            autoApprove: fc.workers?.autoApprove ?? false,
            maxConcurrentJobs: fc.workers?.maxConcurrentJobs ?? 3,
            workerTimeoutMs: fc.workers?.workerTimeoutMs ?? 300_000,
            reportsDir: join(homedir(), ".agi", "reports"),
            modelMap: {
              haiku: "claude-haiku-4-5-20251001",
              sonnet: fc.agent?.model ?? "claude-sonnet-4-6",
              opus: "claude-opus-4-6",
              default: fc.agent?.model ?? "claude-sonnet-4-6",
            },
          }, llmProvider);
          log.info("worker runtime config hot-swapped");
        } catch (err) {
          log.error(`failed to hot-swap worker runtime: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Hot-swap auth tokens and password
      if (event.changedKeys.some((k) => k === "auth")) {
        try {
          const fc = freshConfig as { auth?: { tokens?: string[]; password?: string; maxAttemptsPerWindow?: number; rateLimitWindowMs?: number; lockoutDurationMs?: number; maxBodyBytes?: number } };
          auth.reloadConfig({
            tokens: fc.auth?.tokens ?? [],
            password: fc.auth?.password,
            maxAttemptsPerWindow: fc.auth?.maxAttemptsPerWindow,
            rateLimitWindowMs: fc.auth?.rateLimitWindowMs,
            lockoutDurationMs: fc.auth?.lockoutDurationMs,
            maxBodyBytes: fc.auth?.maxBodyBytes,
          });
          log.info("auth config hot-swapped");
        } catch (err) {
          log.error(`failed to hot-swap auth: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Dispatch config:changed hooks to plugins
      for (const key of event.changedKeys) {
        hookBus.dispatch("config:changed", key, (freshConfig as Record<string, unknown>)[key]).catch((err: unknown) => {
          log.error(`config:changed hook error for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      // Hot-reload HF config section — enable/disable takes effect immediately because
      // isEnabled() reads from the live in-memory config object which was already updated above.
      // The API token cannot be changed without restarting (HfHubClient is constructed at boot),
      // but that edge case is documented and uncommon.
      if (event.changedKeys.some((k) => k === "hf")) {
        const freshHf = (freshConfig as Record<string, unknown>).hf as { apiToken?: string } | undefined;
        if (freshHf?.apiToken !== undefined) {
          // HfHubClient reads token at construction time — log a notice so users know
          // a restart is needed to pick up a new API token.
          log.info("HF config hot-reloaded (note: API token changes require a restart to take effect)");
        } else {
          log.info("HF config hot-reloaded");
        }
      }

      // Broadcast config change to connected dashboard clients
      wsServer.broadcast("config_reloaded", {
        changedKeys: event.changedKeys,
        timestamp: event.timestamp,
      });
    });

    configWatcher.on("error", (err: unknown) => {
      log.error(`config watcher error: ${err instanceof Error ? err.message : String(err)}`);
    });

    configWatcher.start();
    log.info(`config hot-reload enabled for ${opts.configPath}`);
  }

  // -------------------------------------------------------------------------
  // Shutdown — idempotent close() handle
  // -------------------------------------------------------------------------

  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;

    log.info("shutting down...");

    // Step -1: Write shutdown marker FIRST — captures running project + model
    // containers so the next boot can tell this was a graceful exit and can
    // restart anything that drifted (e.g. podman-restart missed it after an
    // unrelated crash). Must run before any subsystem tears down its state.
    try {
      const marker = buildShutdownMarker(
        hostingManager.snapshotRunning(),
        modelContainerManager.snapshotRunning(),
        "sigterm",
      );
      writeShutdownMarker(marker);
      log.info(
        `shutdown marker written: ${String(marker.projects.length)} project(s), ${String(marker.models.length)} model(s)`,
      );
    } catch (err) {
      log.error(
        `failed to write shutdown marker: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Step 0: Stop heartbeat scheduler
    if (heartbeatScheduler !== null) {
      heartbeatScheduler.stop();
    }

    // Stop HF health monitor
    clearInterval(hfHealthMonitorInterval);

    // K.4: aion-micro is now Lemonade-backed — no container to stop.

    // Step 1: Stop QueueConsumer polling — drain in-flight messages first
    try {
      await queueConsumer.stop();
    } catch (err) {
      log.error(`error stopping queue consumer: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 2: Stop all channels
    try {
      await channelRegistry.stopAll();
    } catch (err) {
      log.error(`error stopping channels: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 3: Stop AgentSessionManager sweep
    agentSessionManager.stopSweep();

    // Step 4: Stop SessionStore reaper
    sessionStore.stopReaper();

    // Step 5: Stop DashboardEventBroadcaster + Skills watcher + Config watcher + Hosting
    if (dashboardBroadcaster !== null) {
      dashboardBroadcaster.destroy();
    }
    skillRegistry.destroy();
    if (configWatcher !== null) {
      configWatcher.stop();
    }
    await hostingManager.shutdown();

    // Step 5e-workers: Shut down worker runtime (drain in-flight jobs)
    try {
      await workerRuntime.shutdown();
    } catch (err) {
      log.error(`error shutting down worker runtime: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 5f: Close terminal sessions
    terminalManager.closeAll();

    // Step 5g: Shut down service manager
    await serviceManager.shutdown();

    // Step 5i: Shut down model runtime (stop all model containers)
    try {
      await modelContainerManager.stopAll();
    } catch (err) {
      log.error(`error stopping model containers: ${err instanceof Error ? err.message : String(err)}`);
    }
    modelAgentBridge.destroy();

    // Step 5g2: Stop scheduled tasks
    scheduledTaskManager.stop();

    // Step 5h: Deactivate plugins
    await pluginRegistry.deactivateAll((pluginId, err) => {
      log.warn(`plugin "${pluginId}" deactivation error: ${err instanceof Error ? err.message : String(err)}`);
    });
    hookBus.clear();

    // Step 6: Close WebSocket server
    try {
      await wsServer.stop();
    } catch (err) {
      log.error(`error stopping WebSocket server: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 7: Close HTTP server
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err !== undefined && err !== null) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Step 8: Close database pool
    try {
      await dbPool.end();
    } catch (err) {
      log.error(`error closing database: ${err instanceof Error ? err.message : String(err)}`);
    }

    log.info("shutdown complete");
    logger.close();
  };

  return { close };
}
