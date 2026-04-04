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
import { createDatabase, EntityStore, MessageQueue, CommsLog, NotificationStore, IncidentStore, VendorStore, SessionStore as ComplianceSessionStore, ConsentStore, UsageStore } from "@aionima/entity-model";
import { BackupManager } from "./backup-manager.js";
import { registerComplianceRoutes } from "./compliance-api.js";
import { registerSecurityRoutes } from "./security-api.js";
import { ScanProviderRegistry, ScanStore, ScanRunner, sastScanner, scaScanner, secretsScanner, configScanner } from "@aionima/security";
import { COAChainLogger } from "@aionima/coa-chain";
import { PairingStore } from "./pairing-store.js";
import type { AionimaMessage } from "@aionima/channel-sdk";
import { createLogger, createComponentLogger } from "./logger.js";
import type { Logger, LogEntry } from "./logger.js";

import type { AionimaConfig, ConfigReloadEvent } from "@aionima/config";
import { ConfigWatcher } from "@aionima/config";

import { SecretsManager } from "./secrets.js";
import { GatewayAuth } from "./auth.js";
import { GatewayStateMachine } from "./state-machine.js";
import type { StateTransition } from "./state-machine.js";
import type { WSMessage } from "./ws-server.js";
import { InboundRouter } from "./inbound-router.js";
import { OutboundDispatcher } from "./outbound-dispatcher.js";
import { QueueConsumer } from "./queue-consumer.js";
import { AgentSessionManager } from "./agent-session.js";
import { SessionStore } from "./session-store.js";
import { createLLMProvider } from "./llm/index.js";
import { RateLimiter } from "./rate-limiter.js";
import { ToolRegistry } from "./tool-registry.js";
import { AgentInvoker } from "./agent-invoker.js";
import { registerAllTools, registerAgentTools } from "./tools/index.js";
import { SkillRegistry } from "@aionima/skills";
import { CompositeMemoryAdapter } from "@aionima/memory";
import {
  VoicePipeline,
  WhisperSTTProvider,
  LocalSTTProvider,
  EdgeTTSProvider,
  LocalTTSProvider,
} from "@aionima/voice";
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
import { buildTynnSyncPrompt } from "./plan-tynn-mapper.js";
import { projectConfigPath } from "./project-config-path.js";
import { HostingManager } from "./hosting-manager.js";
import { createProjectTypeRegistry } from "./project-types.js";
import { TerminalManager } from "./terminal-manager.js";
import { discoverPlugins, getDefaultSearchPaths, loadPlugins, PluginRegistry, HookBus } from "@aionima/plugins";
import { ServiceManager } from "./service-manager.js";
import { bridgePluginCapabilities } from "./plugin-bridges.js";
import { ScheduledTaskManager } from "./scheduled-task-manager.js";
import { MarketplaceManager } from "@aionima/marketplace";
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
import { appendUpgradeLog } from "./upgrade-log.js";

// ---------------------------------------------------------------------------
// Quick reply suggestion generator
// ---------------------------------------------------------------------------

function generateQuickReplies(responseText: string): string[] {
  const suggestions: string[] = [];
  const text = responseText.toLowerCase();

  // Context-aware suggestions based on response content
  if (text.includes("would you like") || text.includes("shall i") || text.includes("do you want")) {
    suggestions.push("Yes, go ahead");
    suggestions.push("No, thanks");
  }
  if (text.includes("error") || text.includes("failed") || text.includes("issue")) {
    suggestions.push("Show me the details");
    suggestions.push("How can I fix this?");
  }
  if (text.includes("created") || text.includes("done") || text.includes("completed") || text.includes("finished")) {
    suggestions.push("What's next?");
  }
  if (text.includes("project") || text.includes("file") || text.includes("code")) {
    suggestions.push("Tell me more");
  }
  if (suggestions.length === 0) {
    suggestions.push("Tell me more");
    suggestions.push("What else can you do?");
  }
  return suggestions.slice(0, 4);
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

  const dbPath = config.entities?.path ?? "./data/entities.db";
  const db = createDatabase(dbPath);
  const entityStore = new EntityStore(db);
  const messageQueue = new MessageQueue(db);
  const coaLogger = new COAChainLogger(db);
  const commsLog = new CommsLog(db);
  const notificationStore = new NotificationStore(db);
  const incidentStore = new IncidentStore(db);
  const vendorStore = new VendorStore(db);
  const complianceSessionStore = new ComplianceSessionStore(db);
  // ConsentStore initialized — tables created on construction, available for future consent API
  void new ConsentStore(db);
  const usageStore = new UsageStore(db);

  // Seed vendors from configured providers
  vendorStore.seedFromConfig(config as Record<string, unknown>);

  // Start backup manager if enabled
  let backupManager: BackupManager | undefined;
  if (config.backup?.enabled !== false) {
    const backupDir = (config.backup?.dir ?? join(homedir(), ".agi", "backups")).replace(/^~/, homedir());
    backupManager = new BackupManager({
      backupDir,
      databases: [{ name: "entities", db }],
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
  const protocolResult = checkProtocolCompatibility(agiRoot, primeDir, null, idDir);
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

      let ownerEntity: ReturnType<EntityStore["resolveOrCreate"]> | undefined;

      for (const [channel, channelUserId] of channelEntries) {
        const existing = entityStore.getEntityByChannel(channel, channelUserId);
        if (existing !== null) {
          ownerEntity = existing;
          break;
        }
      }

      // If no existing entity found, create one from the first channel
      if (ownerEntity === undefined) {
        const [firstChannel, firstUserId] = channelEntries[0]!;
        ownerEntity = entityStore.resolveOrCreate(firstChannel, firstUserId, ownerConfig.displayName);
      }

      // Link all channels to the resolved entity
      for (const [channel, channelUserId] of channelEntries) {
        entityStore.upsertChannelAccount({
          entityId: ownerEntity.id,
          channel,
          channelUserId,
        });
      }

      // Ensure the owner entity is sealed (full access)
      if (ownerEntity.verificationTier !== "sealed") {
        entityStore.updateEntity(ownerEntity.id, { verificationTier: "sealed" });
      }
      // Update display name if it was "Unknown"
      if (ownerEntity.displayName === "Unknown") {
        entityStore.updateEntity(ownerEntity.id, { displayName: ownerConfig.displayName });
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
    resolveCoaAlias: (entityId: string) => entityStore.getEntity(entityId)?.coaAlias ?? "#E?",
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

  let llmProvider = createLLMProvider(config);
  const getLLMProvider = () => llmProvider;

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

  // In-flight session data for persistence — maps sessionId → PersistedChatSession
  const chatSessionData = new Map<string, PersistedChatSession>();
  const canvasDocuments: CanvasDocument[] = [];
  // Late-bound worker runtime ref — populated after workerRuntime is created below.
  // The onJobCreated callback is only invoked during agent tool execution (after boot),
  // so workerRuntimeRef.current is always set by the time it is first called.
  const workerRuntimeRef: { current: WorkerRuntime | null } = { current: null };

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
    botsDir: undefined, // BOTS repo removed — workers are now plugins
    onJobCreated: (jobId: string, coaReqId: string) => {
      workerRuntimeRef.current?.executeJob(jobId, coaReqId).catch((err: unknown) => {
        log.error(`workerRuntime.executeJob error: ${err instanceof Error ? err.message : String(err)}`);
      });
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
    },
    { llmProvider: getLLMProvider() },
  );

  // Wire the late-bound ref so onJobCreated callbacks reach the runtime.
  workerRuntimeRef.current = workerRuntime;

  const reportsStore = new ReportsStore(join(homedir(), ".agi", "reports"));
  reportsStore.watch();

  // -------------------------------------------------------------------------
  // Step 5b-security: Security scanning
  // -------------------------------------------------------------------------

  const scanRegistry = new ScanProviderRegistry();
  const scanStore = new ScanStore();
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

          const systemEntity = entityStore.resolveOrCreate("system", "$BOOTSTRAP", "System Bootstrap");

          await agentInvoker.process({
            entity: systemEntity,
            channel: "system",
            content: bootstrapContent,
            coaFingerprint: coaLogger.log({
              resourceId,
              entityId: systemEntity.id,
              entityAlias: systemEntity.coaAlias,
              nodeId,
              workType: "action",
            }),
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

        const entity = entityStore.getEntity(entityId);
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
    const { initADF, Log } = await import("@aionima/sdk");
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
    });
    Log().info("ADF initialized — facades available");
  }

  // -------------------------------------------------------------------------
  // Step 5f: Plugin system — marketplace, auto-install, discover, load
  // -------------------------------------------------------------------------

  // Create the marketplace manager early so we can auto-install required plugins.
  const marketplaceDbPath = join(dirname(dbPath), "marketplace.db");
  const pluginCacheDir = join(homedir(), ".agi", "plugins", "cache");
  const marketplaceManager = new MarketplaceManager({
    dbPath: marketplaceDbPath,
    workspaceRoot,
    cacheDir: pluginCacheDir,
    installDir: process.cwd(),
  });

  // Seed default marketplace source if none exist yet.
  const existingSources = marketplaceManager.getSources();
  if (existingSources.length === 0) {
    marketplaceManager.addSource("Civicognita/aionima-marketplace", "Aionima");
    log.info("marketplace: seeded default source (Civicognita/aionima-marketplace)");
  }

  // Sync the local marketplace catalog into the DB so version checks are current.
  const marketplaceDir = config.marketplace?.dir ?? "/opt/aionima-marketplace";
  if (existsSync(marketplaceDir)) {
    const syncResult = marketplaceManager.syncLocalCatalog(marketplaceDir);
    if (syncResult.ok) {
      log.info(`marketplace: synced ${String(syncResult.pluginCount)} plugins from local catalog`);
    } else {
      log.warn(`marketplace: local catalog sync failed: ${syncResult.error}`);
    }

    // Reconcile installed plugins — re-install any whose source files changed
    const reconcileResult = await marketplaceManager.reconcileInstalled(marketplaceDir);
    if (reconcileResult.updated.length > 0) {
      log.info(`marketplace: updated ${String(reconcileResult.updated.length)} plugin(s): ${reconcileResult.updated.join(", ")}`);
    }
    for (const err of reconcileResult.errors) {
      log.warn(`marketplace: reconcile error: ${err}`);
    }
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
          const isInDb = marketplaceManager.isInstalled(req.id);
          const cacheEntry = join(pluginCacheDir, req.id);
          const hasBuilt = existsSync(join(cacheEntry, "dist", "index.js"));

          if (isInDb && !hasBuilt) {
            log.info(`repairing unbuilt install for required plugin: ${req.id}`);
            marketplaceManager.uninstall(req.id, true);
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
    } catch (err) {
      log.warn(`failed to load required-plugins.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const pluginRegistry = new PluginRegistry();
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
    log.info(`plugins: ${String(installedDiscovery.plugins.length)} installed from marketplace cache`);
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
    },
    workspaceProjects: projectPaths,
    projectTypeRegistry,
    pluginRegistry,
    stackRegistry,
    sharedContainerManager,
    logger,
  });

  // -------------------------------------------------------------------------
  // Step 5h-early: Caddy system domains (dashboard reverse proxy available ASAP)
  // -------------------------------------------------------------------------

  hostingManager.regenerateSystemDomains();

  // -------------------------------------------------------------------------
  // Terminal session manager
  // -------------------------------------------------------------------------

  const terminalManager = new TerminalManager();

  // MarketplaceManager created earlier (Step 5f) for required plugin auto-install.

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
  });
  log.info(`registered ${String(agentToolCount)} agent tools`);

  // -------------------------------------------------------------------------
  // Step 4: Runtime state creation (HTTP + WS servers)
  //
  // Note: Step 4 is performed after core services are constructed so that
  // the HTTP handler can close over them (channelRegistry, agentSessionManager).
  // -------------------------------------------------------------------------

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
      webhookSecret: config.workspace?.webhookSecret,
      logger,
      hostingManager,
      commsLog,
      notificationStore,
      chatPersistence,
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
      botsDir: undefined, // BOTS repo removed — workers are now plugins
      marketplaceManager,
      onPluginInstalled: async (installPath: string) => {
        try {
          const newDiscovery = discoverPlugins([installPath]);
          if (newDiscovery.plugins.length === 0) {
            return { loaded: false, error: "No plugin found at install path" };
          }
          const pluginToLoad = newDiscovery.plugins[0]!;
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
            log.info(`hot-loaded plugin: ${pluginToLoad.manifest.id}`);
            return { loaded: true, pluginId: pluginToLoad.manifest.id };
          }
          return { loaded: false, error: result.failed[0]?.error ?? "Unknown error" };
        } catch (err) {
          return { loaded: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      secrets,
      config: config as Record<string, unknown>,
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
        (f) => registerWorkerApi(f, workerRuntime),
        (f) => registerComplianceRoutes(f, { incidentStore, vendorStore, sessionStore: complianceSessionStore, backupManager }),
        (f) => registerSecurityRoutes(f, { scanRunner, scanStore }),
      ],
    },
    { host, port },
  );

  // Populate wsRef so the HiTL broadcast in onInbound can reach the WS server.
  wsRef.server = wsServer;

  // -------------------------------------------------------------------------
  // Post-upgrade boot detection — if deploy.sh restarted the service, finalize the upgrade log
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

  // Track topic subscriptions per connection
  const subscriptions = new Map<string, Set<string>>();

  wsServer.on("message", (connectionId: string, message: WSMessage) => {
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
        const replyEntity = entityStore.getEntity(entityId);
        if (replyEntity === null) {
          log.warn(`reply_request: entity ${entityId} not found`);
          break;
        }

        const channelAccounts = entityStore.getChannelAccounts(entityId);
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

          // Re-hydrate the agent session so LLM has full context
          const agentSession = agentSessionManager.getOrCreate(sessionKey, ownerEntityId, "web");
          if (agentSession.turns.length === 0) {
            for (const msg of persisted.messages) {
              if (msg.role === "user") {
                agentSessionManager.addUserTurn(sessionKey, msg.content, "");
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

        const chatEntity = entityStore.getEntity(ownerEntityId);
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

        wsServer.sendTo(connectionId, "chat:thinking", {
          sessionId: chatSessionId,
          runId,
          timestamp: new Date().toISOString(),
        });

        // Track user message for persistence
        if (chatSessionId) {
          const existing = chatSessionData.get(chatSessionId);
          if (existing) {
            chatSessionData.set(chatSessionId, ChatPersistence.appendMessage(existing, {
              role: "user",
              content: typeof chatText === "string" ? chatText : "[media]",
              timestamp: new Date().toISOString(),
              runId,
            }));
          }
        }

        const chatCoaFingerprint = coaLogger.log({
          resourceId,
          entityId: ownerEntityId,
          entityAlias: chatEntity.coaAlias,
          nodeId,
          workType: "action",
        });

        // Derive project path from context (non-"general" context is a project path).
        // This is `let` because manage_project can upgrade a general session to project context.
        let chatProjectPath = chatPayload?.context !== "general" ? chatPayload?.context : undefined;

        // Emit invocation_start to project activity indicators.
        if (chatProjectPath !== undefined) {
          dashboardBroadcasterRef?.emitProjectActivity({
            projectPath: chatProjectPath,
            type: "invocation_start",
            summary: "Processing chat message...",
          });
        }

        // Progressive chat update listeners
        const toolActivityMap: Record<string, string> = {
          manage_project: "Updating project...",
          shell_exec: "Running commands...",
          dir_list: "Browsing files...",
        };
        const toolStartHandler = (data: { sessionKey: string; toolName: string; toolIndex: number; loopIteration: number; toolInput?: Record<string, unknown> }) => {
          if (data.sessionKey !== sessionKey) return;
          wsServer.sendTo(connectionId, "chat:tool_start", {
            sessionId: chatSessionId,
            runId,
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
          wsServer.sendTo(connectionId, "chat:tool_result", {
            sessionId: chatSessionId,
            runId,
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
                runId,
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
                wsServer.sendTo(connectionId, "chat:context_set", {
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
          wsServer.sendTo(connectionId, "chat:progress", {
            sessionId: chatSessionId,
            text: data.text,
            phase: data.phase,
            timestamp: new Date().toISOString(),
          });
        };
        const thoughtHandler = (data: { sessionKey: string; content: string }) => {
          if (data.sessionKey !== sessionKey) return;
          const thoughtTs = new Date().toISOString();
          wsServer.sendTo(connectionId, "chat:thought", {
            sessionId: chatSessionId,
            runId,
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
                runId,
              }));
            }
          }
        };

        agentInvoker.on("tool_start", toolStartHandler);
        agentInvoker.on("tool_result", toolResultHandler);
        agentInvoker.on("progress", progressHandler);
        agentInvoker.on("thought", thoughtHandler);

        const removeProgressListeners = () => {
          agentInvoker.removeListener("tool_start", toolStartHandler);
          agentInvoker.removeListener("tool_result", toolResultHandler);
          agentInvoker.removeListener("progress", progressHandler);
          agentInvoker.removeListener("thought", thoughtHandler);
        };

        const chainKey = sessionKey ?? `${ownerEntityId}:web:default`;
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
          });
        }).then(async (outcome) => {
          removeProgressListeners();
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
            wsServer.sendTo(connectionId, "chat:response", {
              sessionId: chatSessionId,
              runId,
              text,
              timestamp: new Date().toISOString(),
            });
            // Generate quick reply suggestions from the response
            const suggestions = generateQuickReplies(text);
            if (suggestions.length > 0) {
              wsServer.sendTo(connectionId, "chat:suggestions", {
                sessionId: chatSessionId,
                suggestions,
              });
            }

            // Record usage (tokens + cost + project attribution)
            if (outcome.usage && outcome.model) {
              try {
                usageStore.record({
                  entityId: ownerEntityId,
                  projectPath: chatProjectPath,
                  provider: outcome.provider ?? "unknown",
                  model: outcome.model,
                  inputTokens: outcome.usage.inputTokens,
                  outputTokens: outcome.usage.outputTokens,
                  coaFingerprint: outcome.coaFingerprint,
                  toolCount: outcome.toolCount ?? 0,
                  loopCount: outcome.loopCount ?? 0,
                });
              } catch (usageErr) {
                log.warn(`usage recording failed: ${usageErr instanceof Error ? usageErr.message : String(usageErr)}`);
              }
            }

            // Persist session to disk
            if (chatSessionId) {
              const existing = chatSessionData.get(chatSessionId);
              if (existing) {
                const updated = ChatPersistence.appendMessage(existing, {
                  role: "assistant",
                  content: text,
                  timestamp: new Date().toISOString(),
                  runId,
                });
                chatSessionData.set(chatSessionId, updated);
                try { chatPersistence.save(updated); } catch { /* non-fatal */ }
              }
            }
          } else if (outcome.type === "error") {
            wsServer.sendTo(connectionId, "chat:error", { sessionId: chatSessionId, error: outcome.message });
          } else if (outcome.type === "rate_limited") {
            wsServer.sendTo(connectionId, "chat:error", { sessionId: chatSessionId, error: outcome.entityNotification });
          } else if (outcome.type === "queued") {
            wsServer.sendTo(connectionId, "chat:response", {
              sessionId: chatSessionId,
              text: outcome.entityNotification || "[Message queued]",
              timestamp: new Date().toISOString(),
            });
          } else if (outcome.type === "human_routed") {
            wsServer.sendTo(connectionId, "chat:response", {
              sessionId: chatSessionId,
              text: "[Routed to human operator]",
              timestamp: new Date().toISOString(),
            });
          } else if (outcome.type === "log_only") {
            wsServer.sendTo(connectionId, "chat:response", {
              sessionId: chatSessionId,
              text: "[Logged — no response in current state]",
              timestamp: new Date().toISOString(),
            });
          }

          // Drain any remaining injected messages that weren't consumed during the
          // tool loop (e.g. when the agent responded with text only, no tools).
          // Re-invoke the agent for each so the frontend's pending counter clears.
          if (sessionKey) {
            const remaining = agentInvoker.drainInjections(sessionKey);
            for (const injText of remaining) {
              const injRunId = ulid();
              wsServer.sendTo(connectionId, "chat:thinking", {
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
                  wsServer.sendTo(connectionId, "chat:response", {
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
                  wsServer.sendTo(connectionId, "chat:error", { sessionId: chatSessionId, error: injOutcome.message });
                }
              } catch (injErr: unknown) {
                log.error(`chat:inject follow-up error: ${injErr instanceof Error ? injErr.message : String(injErr)}`);
                wsServer.sendTo(connectionId, "chat:error", {
                  sessionId: chatSessionId,
                  error: injErr instanceof Error ? injErr.message : "Follow-up processing failed",
                });
              }
            }
          }
        }).catch((err: unknown) => {
          removeProgressListeners();
          // Emit invocation_complete even on error so the indicator doesn't get stuck.
          if (chatProjectPath !== undefined) {
            dashboardBroadcasterRef?.emitProjectActivity({
              projectPath: chatProjectPath,
              type: "invocation_complete",
              summary: "Completed",
            });
          }
          log.error(`chat:send error: ${err instanceof Error ? err.message : String(err)}`);
          wsServer.sendTo(connectionId, "chat:error", {
            sessionId: chatSessionId,
            error: err instanceof Error ? err.message : "Agent processing failed",
          });
        }).finally(() => {
          if (sessionProcessingChain.get(chainKey) === current) {
            sessionProcessingChain.delete(chainKey);
          }
        }) as Promise<void>;
        sessionProcessingChain.set(chainKey, current);
        break;
      }

      case "chat:close": {
        // Close a chat session (no-op server-side; session stays in memory for resume)
        const closePayload = message.payload as { sessionId?: string } | undefined;
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
          const syncEntity = entityStore.getEntity(ownerEntityId);
          if (syncEntity !== null) {
            const syncCoaFingerprint = coaLogger.log({
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

        // Send recent history from activity.log
        const logDir = config.logging?.logDir ?? "./logs";
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
        const termProjectPath = termPayload?.projectPath;
        if (typeof termProjectPath !== "string" || termProjectPath.length === 0) {
          wsServer.sendTo(connectionId, "terminal:error", { error: "projectPath is required" });
          break;
        }
        const sessionId = `term_${ulid()}`;
        const termSession = terminalManager.open(sessionId, termProjectPath, termPayload?.cols ?? 80, termPayload?.rows ?? 24);
        if (termSession === null) {
          wsServer.sendTo(connectionId, "terminal:error", { error: "Project directory not found" });
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
        wsServer.sendTo(connectionId, "terminal:opened", { sessionId, projectPath: termProjectPath });
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
  });

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

  // Wire worker runtime events to the dashboard broadcaster.
  if (dashboardBroadcaster !== null) {
    workerRuntime.on("runtime:event", (event: { type: string; jobId: string; [key: string]: unknown }) => {
      if (event.type === "job_started") {
        dashboardBroadcaster.emitBotsJobUpdate({
          jobId: event.jobId,
          status: "running",
          description: String(event.description ?? ""),
          currentPhase: null,
          workers: (event.workers as string[]) ?? [],
        });
      } else if (event.type === "job_failed") {
        dashboardBroadcaster.emitBotsJobUpdate({
          jobId: event.jobId,
          status: "failed",
          description: String(event.error ?? ""),
          currentPhase: null,
          workers: [],
        });
      }
      // worker_done, phase_done, checkpoint, report_ready handled by workerRuntime
      // internal tracking; no dedicated broadcaster method for these yet.
    });
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

      // Hot-swap LLM provider when agent or bots config changes
      if (event.changedKeys.some((k) => k === "agent" || k === "bots")) {
        try {
          llmProvider = createLLMProvider(event.config);
          log.info("LLM provider hot-swapped");
        } catch (err) {
          log.error(`failed to hot-swap LLM provider: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Dispatch config:changed hooks to plugins
      for (const key of event.changedKeys) {
        hookBus.dispatch("config:changed", key, (freshConfig as Record<string, unknown>)[key]).catch((err: unknown) => {
          log.error(`config:changed hook error for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
        });
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

    // Step 0: Stop heartbeat scheduler
    if (heartbeatScheduler !== null) {
      heartbeatScheduler.stop();
    }

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

    // Step 8: Close database
    try {
      db.close();
    } catch (err) {
      log.error(`error closing database: ${err instanceof Error ? err.message : String(err)}`);
    }

    log.info("shutdown complete");
    logger.close();
  };

  return { close };
}
