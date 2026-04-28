import { z } from "zod";

const GatewayStateSchema = z.enum(["ONLINE", "LIMBO", "OFFLINE", "UNKNOWN"]);

const GatewayConfigSchema = z
  .object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(3100),
    state: GatewayStateSchema.default("OFFLINE"),
    /** Release channel: "main" (stable) or "dev" (bleeding edge). Controls which branch all repos track for updates. */
    updateChannel: z.enum(["main", "dev"]).optional(),
    /** Max tool-loop iterations per agent turn. The circuit breaker on
     *  duplicate tool calls (same tool + same input >3 times) already
     *  prevents runaway loops, so this is purely a cost ceiling. Set to 0
     *  for no cap (default). */
    maxToolLoops: z.number().int().min(0).optional(),
    /** Periodically sync Plugin + MApp marketplaces in the background.
     *  When true, a scheduled task checks for catalog updates every 30 min. */
    autoSyncMarketplace: z.boolean().default(true).optional(),
  })
  .strict();

const ChannelConfigSchema = z
  .object({
    id: z.string(),
    enabled: z.boolean().default(true),
    config: z.record(z.unknown()).optional(),
  })
  .strict();

const EntityStoreConfigSchema = z
  .object({
    path: z.string().default("./data/entities.db"),
  })
  .strict();

const AuthConfigSchema = z
  .object({
    /** Bearer tokens that grant gateway access. */
    tokens: z.array(z.string()).default([]),
    /** Optional password-based auth alternative. */
    password: z.string().optional(),
    /** Max auth attempts per IP per window before lockout. */
    maxAttemptsPerWindow: z.number().int().positive().default(10),
    /** Rate limit window in ms. */
    rateLimitWindowMs: z.number().int().positive().default(60000),
    /** Lockout duration in ms after too many failed attempts. */
    lockoutDurationMs: z.number().int().positive().default(300000),
    /** Maximum HTTP request body size in bytes (2 MB default). */
    maxBodyBytes: z.number().int().positive().default(2097152),
  })
  .strict();

const CostModeSchema = z.enum(["local", "economy", "balanced", "max"]);

const RouterConfigSchema = z
  .object({
    /** Active cost mode — controls which models the router selects. */
    costMode: CostModeSchema.default("balanced"),
    /** Enable confidence-based escalation (cheap model first, re-route on low confidence). */
    escalation: z.boolean().default(false),
    /** Maximum escalations per turn to prevent cost spiraling. */
    maxEscalationsPerTurn: z.number().int().min(0).default(1),
    /** Token threshold below which a request is classified as "simple". */
    simpleThresholdTokens: z.number().int().positive().default(500),
    /** Token threshold above which a request is classified as "complex". */
    complexThresholdTokens: z.number().int().positive().default(2000),
  })
  .strict();

const ProviderConfigSchema = z
  .object({
    /** Provider type. Built-in or plugin-contributed. */
    type: z.string(),
    /** Model identifier for this provider. */
    model: z.string(),
    /** API key (falls back to env var per provider). */
    apiKey: z.string().optional(),
    /** Base URL for self-hosted or proxy deployments. */
    baseUrl: z.string().optional(),
  })
  .strict();

const AgentPmConfigSchema = z
  .object({
    /** PM provider selector. Built-in: "tynn" (default — uses MCP to reach
     *  tynn-the-service), "tynn-lite" (file-based fallback at
     *  <project>/.tynn-lite/). Plugins can contribute additional ids via
     *  api.registerPmProvider() (s118 t434). */
    provider: z.string().default("tynn"),
    /** Provider-specific config passed to the factory at instantiation.
     *  E.g. tynn-lite: { projectRoot, projectName }; plugin-registered:
     *  whatever the plugin's factory expects. */
    config: z.record(z.unknown()).optional(),
  })
  .strict();

const AgentConfigSchema = z
  .object({
    /** COA resource identifier (e.g. "$A0"). */
    resourceId: z.string().default("$A0"),
    /** COA node identifier (e.g. "@A0"). */
    nodeId: z.string().default("@A0"),
    /** LLM provider type. Built-in: anthropic, openai, ollama. Plugins can
     *  contribute additional types (e.g. "claude-max") via api.registerProvider(). */
    provider: z.string().default("anthropic"),
    /** Default model identifier (provider-specific). */
    model: z.string().default("claude-sonnet-4-6"),
    /** Max response tokens. */
    maxTokens: z.number().int().positive().default(8192),
    /** Max retry attempts on transient API errors. */
    maxRetries: z.number().int().min(0).default(3),
    /** Base URL for self-hosted or proxy deployments (e.g. Ollama). */
    baseUrl: z.string().optional(),
    /** Failover provider list — tried in order on transient errors. */
    providers: z.array(ProviderConfigSchema).optional(),
    /**
     * Reply mode: "autonomous" dispatches responses directly to the channel;
     * "human-in-loop" broadcasts the response via WS for operator approval first.
     */
    replyMode: z.enum(["autonomous", "human-in-loop"]).default("autonomous"),
    /** Enable developer identity and workspace context injection. */
    devMode: z.boolean().optional().default(false),
    /** Intelligent routing configuration — always active. */
    router: RouterConfigSchema.default({}),
    /** PM provider selection — backs the canonical tynn workflow with
     *  pluggable storage (built-in tynn or tynn-lite, or plugin-registered). */
    pm: AgentPmConfigSchema.default({}),
  })
  .strict();

const QueueConfigSchema = z
  .object({
    /** Queue poll interval in ms. */
    pollIntervalMs: z.number().int().positive().default(100),
    /** Max concurrent message processing. */
    concurrency: z.number().int().positive().default(10),
    /** Shutdown drain timeout in ms. */
    drainTimeoutMs: z.number().int().positive().default(5000),
  })
  .strict();

const SessionsConfigSchema = z
  .object({
    /** Total context window budget in tokens. */
    contextWindowTokens: z.number().int().positive().default(200000),
    /** Session idle timeout in ms (24 hours default). */
    idleTimeoutMs: z.number().int().positive().default(86400000),
    /** Maximum concurrent sessions. */
    maxSessions: z.number().int().positive().default(5000),
  })
  .strict();

const DashboardConfigSchema = z
  .object({
    /** Enable the impact dashboard. */
    enabled: z.boolean().default(true),
    /** Dashboard broadcast interval in ms. */
    broadcastIntervalMs: z.number().int().positive().default(5000),
  })
  .strict();

const SkillsConfigSchema = z
  .object({
    /** Directory containing .skill.md files. */
    directory: z.string().default("./skills"),
    /** Watch for file changes and hot-reload skills. */
    watchForChanges: z.boolean().default(false),
  })
  .strict();

const MemoryConfigSchema = z
  .object({
    /** Directory for file-based memory storage. */
    directory: z.string().default("./data/memory"),
  })
  .strict();

const WorkspaceConfigSchema = z
  .object({
    /** Root directory for dev tools (file ops, git, shell). */
    root: z.string().default("."),
    /** Directories where projects are stored and worked on. */
    projects: z.array(z.string()).default([]),
    /** Path to the aionima source repo (enables dashboard update detection). */
    selfRepo: z.string().optional(),
    /** HMAC secret for GitHub webhook signature verification. */
    webhookSecret: z.string().optional(),
  })
  .strict();

const VoiceConfigSchema = z
  .object({
    /** Enable voice pipeline (STT + TTS). */
    enabled: z.boolean().default(false),
    /** STT provider to use when ONLINE. */
    sttProvider: z.enum(["whisper", "local"]).default("whisper"),
    /** TTS provider to use when ONLINE. */
    ttsProvider: z.enum(["edge", "local"]).default("edge"),
    /** Whisper API key (falls back to OPENAI_API_KEY env var). */
    whisperApiKey: z.string().optional(),
    /** Whisper model to use (default: "whisper-1"). */
    whisperModel: z.string().optional().default("whisper-1"),
  })
  .strict();

const PersonaConfigSchema = z
  .object({
    soulPath: z.string().optional().default("./data/persona/SOUL.md"),
    identityPath: z.string().optional().default("./data/persona/IDENTITY.md"),
  })
  .strict();

const HeartbeatConfigSchema = z
  .object({
    /** Enable autonomous heartbeat. */
    enabled: z.boolean().default(false),
    /** Heartbeat interval in ms (default: 1 hour). */
    intervalMs: z.number().int().positive().default(3600000),
    /** Path to heartbeat prompt file. */
    promptPath: z.string().optional().default("./data/persona/HEARTBEAT.md"),
  })
  .strict();

const HostingConfigSchema = z
  .object({
    /** Enable project hosting infrastructure. */
    enabled: z.boolean().default(false),
    /** LAN IP address for DNS resolution and Caddy binding. Set during install/setup. */
    lanIp: z.string().optional(),
    /** Base domain for hosted projects (e.g. "ai.on"). */
    baseDomain: z.string().default("ai.on"),
    /** Extra domain names that also reverse-proxy to the gateway dashboard. */
    domainAliases: z.array(z.string()).optional(),
    /** Start of the port range for reverse proxies. */
    portRangeStart: z.number().int().min(1024).default(4000),
    /** Container runtime (currently only podman). */
    containerRuntime: z.enum(["podman"]).default("podman"),
    /** Interval in ms for polling container statuses. */
    statusPollIntervalMs: z.number().int().positive().default(120_000),
    /** Default tunnel mode: "quick" (ephemeral URL, no auth) or "named" (persistent URL, requires Cloudflare auth). */
    tunnelMode: z.enum(["quick", "named"]).optional(),
    /** Cloudflare-managed domain for named tunnels (e.g. "example.com"). Named tunnels create DNS records as <project>.<tunnelDomain>. */
    tunnelDomain: z.string().optional(),
  })
  .strict();

const LoggingConfigSchema = z
  .object({
    /** Directory for log files. */
    logDir: z.string().default("~/.agi/logs"),
    /** Max log file size in bytes before rotation (default: 10 MB). */
    maxFileSize: z.number().int().positive().default(10_485_760),
    /** Max number of rotated log files to keep. */
    maxFiles: z.number().int().positive().default(5),
    /** Minimum log level. */
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    /** Also write to stdout/stderr. */
    stdout: z.boolean().default(true),
    /** Total log retention in days (PCI DSS requires >= 365). */
    retentionDays: z.number().int().positive().default(365),
    /** Hot/immediately-available retention in days (PCI DSS requires >= 90). */
    hotRetentionDays: z.number().int().positive().default(90),
  })
  .strict();

const PrimeConfigSchema = z
  .object({
    /** Path to the PRIME knowledge corpus directory. */
    dir: z.string().default("/opt/agi-prime"),
    /** Git remote URL for the PRIME corpus source. */
    source: z.string().default("git@github.com:Civicognita/aionima.git"),
    /** Branch to track. */
    branch: z.string().default("main"),
  })
  .strict();

/** @deprecated Use PrimeConfigSchema — kept for backward compat. */
const LegacyNexusConfigSchema = z
  .object({
    primeDir: z.string().default("./.aionima"),
  })
  .strict();

const OwnerChannelsSchema = z
  .object({
    /** Telegram user ID (numeric string). */
    telegram: z.string().optional(),
    /** Discord user ID (snowflake string). */
    discord: z.string().optional(),
    /** Signal phone number (E.164 format). */
    signal: z.string().optional(),
    /** WhatsApp phone number (E.164 format). */
    whatsapp: z.string().optional(),
    /** Email address. */
    email: z.string().optional(),
  })
  .strict();

const OwnerConfigSchema = z
  .object({
    /** Owner display name. */
    displayName: z.string().default("Owner"),
    /** Channel-specific user IDs that identify the owner. */
    channels: OwnerChannelsSchema.default({}),
    /**
     * DM policy for non-owner users.
     * "pairing" — unknown senders must be approved via pairing code (default).
     * "open" — all senders are allowed through as unverified.
     */
    dmPolicy: z.enum(["pairing", "open"]).default("pairing"),
  })
  .strict();

const WorkerModelOverrideSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
  })
  .strict();

const ProviderCredentialSchema = z
  .object({
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    /** USD amount at which to alert when cumulative API spend reaches this threshold. */
    balanceAlertThreshold: z.number().nonnegative().optional(),
  })
  .strict();

const PluginPreferenceSchema = z
  .object({
    /** Whether this plugin is enabled (default: true). */
    enabled: z.boolean().optional(),
    /** Route priority — higher wins when routes collide between plugins. */
    priority: z.number().optional(),
  })
  .passthrough();

const ServiceOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    port: z.number().int().min(1024).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const ServicesConfigSchema = z
  .object({
    /** Per-service overrides keyed by service ID. */
    overrides: z.record(z.string(), ServiceOverrideSchema).optional(),
  })
  .strict();

const DashboardAuthConfigSchema = z
  .object({
    /** Enable multi-user dashboard authentication. */
    enabled: z.boolean().default(false),
    /** Secret used to sign session tokens (auto-generated on first enable). */
    jwtSecret: z.string().optional(),
    /** Session TTL in milliseconds (default: 24 hours). */
    sessionTtlMs: z.number().int().positive().default(86400000),
  })
  .strict();

const DevConfigSchema = z
  .object({
    /** Enable dev mode — switches all core repos to owner forks. */
    enabled: z.boolean().default(false),
    /** Git remote URL for AGI repo fork. */
    agiRepo: z.string().default("git@github.com:wishborn/agi.git"),
    /** Git remote URL for PRIME repo fork. */
    primeRepo: z.string().default("git@github.com:wishborn/aionima.git"),
    /** Dev directory for PRIME fork. */
    primeDir: z.string().default("/opt/agi-prime_dev"),
    /** Git remote URL for marketplace fork. */
    marketplaceRepo: z.string().default("git@github.com:wishborn/agi-marketplace.git"),
    /** Dev directory for marketplace fork. */
    marketplaceDir: z.string().default("/opt/agi-marketplace_dev"),
    /** Git remote URL for ID service fork. */
    idRepo: z.string().default("git@github.com:wishborn/agi-local-id.git"),
    /** Dev directory for ID service fork. */
    idDir: z.string().default("/opt/agi-local-id_dev"),
    /** Git remote URL for MApp marketplace fork. */
    mappMarketplaceRepo: z.string().default("git@github.com:wishborn/agi-mapp-marketplace.git"),
    /** Dev directory for MApp marketplace fork. */
    mappMarketplaceDir: z.string().default("/opt/agi-mapp-marketplace_dev"),
  })
  .strict();

const AgentCredentialsConfigSchema = z
  .object({
    email: z
      .object({
        provider: z.enum(["google", "outlook"]).optional(),
        address: z.string().optional(),
      })
      .strict()
      .optional(),
    github: z
      .object({
        username: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const WorkersConfigSchema = z
  .object({
    /** Key format: "domain.worker" e.g. "code.hacker", "k.linguist" */
    modelOverrides: z.record(z.string(), WorkerModelOverrideSchema).optional(),
    /** Auto-approve checkpoint gates (skip human review). */
    autoApprove: z.boolean().default(false),
    /** Maximum concurrent worker jobs running at once. */
    maxConcurrentJobs: z.number().int().positive().default(3),
    /** Per-worker timeout in milliseconds. */
    workerTimeoutMs: z.number().int().positive().default(300_000),
  })
  .strict();

const MarketplaceConfigSchema = z
  .object({
    /** Path to the official marketplace directory (plugins repo). */
    dir: z.string().default("/opt/agi-marketplace"),
    /** Git remote URL for the marketplace source. */
    source: z
      .string()
      .default("git@github.com:Civicognita/agi-marketplace.git"),
    /** Branch to track. */
    branch: z.string().default("main"),
  })
  .strict();

const MAppMarketplaceConfigSchema = z
  .object({
    /** Path to the official MApp marketplace directory. */
    dir: z.string().default("/opt/agi-mapp-marketplace"),
    /** Git remote URL for the MApp marketplace source. */
    source: z
      .string()
      .default("git@github.com:Civicognita/agi-mapp-marketplace.git"),
    /** Branch to track. */
    branch: z.string().default("main"),
  })
  .strict();

const FederationConfigSchema = z
  .object({
    /** Enable federation protocol. */
    enabled: z.boolean().default(false),
    /** Public URL for this node (used in manifests and peer discovery). */
    publicUrl: z.string().optional(),
    /** Seed peers to connect to on startup. */
    seedPeers: z.array(z.string()).default(["https://id.aionima.ai"]),
    /** Auto-generate GEID for new entities. */
    autoGeid: z.boolean().default(true),
    /** Allow visitor authentication from federated nodes. */
    allowVisitors: z.boolean().default(true),
  })
  .strict();

const OAuthProviderSchema = z
  .object({
    clientId: z.string(),
    clientSecret: z.string(),
    scopes: z.array(z.string()).optional(),
  })
  .strict();

const IdServiceLocalSchema = z
  .object({
    /** Enable local ID service (runs alongside AGI on this node). */
    enabled: z.boolean().default(false),
    /** Local ID service HTTP port. */
    port: z.number().int().min(1024).default(3200),
    /** Subdomain for the local ID service (e.g. "id" → id.ai.on). */
    subdomain: z.string().default("id"),
    /** PostgreSQL connection string for the local ID service. */
    databaseUrl: z.string().optional(),
    /** Auto-provision a Podman PostgreSQL container for the ID service. */
    postgresContainer: z.boolean().default(true),
  })
  .strict();

const IdServiceConfigSchema = z
  .object({
    /** Path to the ID service directory. */
    dir: z.string().default("/opt/agi-local-id"),
    /** Git remote URL for the ID service source. */
    source: z.string().default("git@github.com:Civicognita/agi-local-id.git"),
    /** Branch to track. */
    branch: z.string().default("main"),
    /** Local self-hosting configuration. */
    local: IdServiceLocalSchema.optional(),
  })
  .strict();

const IdentityConfigSchema = z
  .object({
    /** OAuth provider credentials for local identity issuance. */
    oauth: z
      .object({
        google: OAuthProviderSchema.optional(),
        github: OAuthProviderSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const BackupConfigSchema = z
  .object({
    /** Enable automated backups. */
    enabled: z.boolean().default(true),
    /** Backup directory path. */
    dir: z.string().default("~/.agi/backups"),
    /** Backup retention in days. */
    retentionDays: z.number().int().positive().default(30),
  })
  .strict();

const ComplianceConfigSchema = z
  .object({
    /** Enable field-level encryption for PII at rest. */
    encryptionAtRest: z.boolean().default(false),
    /** Hex-encoded 32-byte encryption key (or $ENV{} reference). */
    encryptionKey: z.string().optional(),
    /** Require MFA for dashboard access. */
    requireMfa: z.boolean().default(false),
  })
  .strict();

const ChatConfigSchema = z
  .object({
    /** Days to retain chat sessions before garbage collection (default: 30). */
    retentionDays: z.number().int().positive().default(30),
  })
  .strict();

const HfConfigSchema = z
  .object({
    /** Enable HuggingFace model runtime. */
    enabled: z.boolean().default(false),
    /** HuggingFace API token for gated model access ($ENV{} reference supported). */
    apiToken: z.string().optional(),
    /** Model cache directory (default: ~/.agi/models). */
    cacheDir: z.string().default("~/.agi/models"),
    /** Port range start for model containers (default: 6000). */
    portRangeStart: z.number().int().min(1024).default(6000),
    /** Maximum concurrent running models (default: 3). */
    maxConcurrentModels: z.number().int().positive().default(3),
    /** RAM budget for all model containers in bytes. 0 = auto-detect (default). */
    ramBudgetBytes: z.number().int().nonnegative().default(0),
    /** Model IDs to auto-start on gateway boot. */
    autoStart: z.array(z.string()).default([]),
    /** Default inference request timeout in ms (default: 120000). */
    inferenceTimeoutMs: z.number().int().positive().default(120_000),
    /** GPU passthrough mode: auto-detect, force nvidia/amd, or cpu-only. */
    gpuMode: z.enum(["auto", "nvidia", "amd", "cpu-only"]).default("auto"),
    /** Override default container images per runtime type. */
    images: z
      .object({
        llm: z.string().optional(),
        diffusion: z.string().optional(),
        general: z.string().optional(),
      })
      .optional(),
  })
  .strict();

const AionMicroConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    port: z.number().int().min(1024).default(5200),
    idleTimeoutMs: z.number().int().positive().default(600_000),
  })
  .strict();

const OpsConfigSchema = z
  .object({
    aionMicro: AionMicroConfigSchema.optional(),
  })
  .strict();

export const AionimaConfigSchema = z
  .object({
    gateway: GatewayConfigSchema.optional(),
    channels: z.array(ChannelConfigSchema).default([]),
    entities: EntityStoreConfigSchema.optional(),
    auth: AuthConfigSchema.optional(),
    agent: AgentConfigSchema.optional(),
    queue: QueueConfigSchema.optional(),
    sessions: SessionsConfigSchema.optional(),
    dashboard: DashboardConfigSchema.optional(),
    skills: SkillsConfigSchema.optional(),
    memory: MemoryConfigSchema.optional(),
    workspace: WorkspaceConfigSchema.optional(),
    voice: VoiceConfigSchema.optional(),
    persona: PersonaConfigSchema.optional(),
    heartbeat: HeartbeatConfigSchema.optional(),
    prime: PrimeConfigSchema.optional(),
    /** @deprecated Use `prime` instead. */
    nexus: LegacyNexusConfigSchema.optional(),
    hosting: HostingConfigSchema.optional(),
    plugins: z.record(z.string(), PluginPreferenceSchema).optional(),
    services: ServicesConfigSchema.optional(),
    owner: OwnerConfigSchema.optional(),
    logging: LoggingConfigSchema.optional(),
    /** System-level LLM provider credentials keyed by provider name. */
    providers: z.record(z.string(), ProviderCredentialSchema).optional(),
    workers: WorkersConfigSchema.optional(),
    marketplace: MarketplaceConfigSchema.optional(),
    mappMarketplace: MAppMarketplaceConfigSchema.optional(),
    idService: IdServiceConfigSchema.optional(),
    dev: DevConfigSchema.optional(),
    dashboardAuth: DashboardAuthConfigSchema.optional(),
    federation: FederationConfigSchema.optional(),
    identity: IdentityConfigSchema.optional(),
    agentCredentials: AgentCredentialsConfigSchema.optional(),
    backup: BackupConfigSchema.optional(),
    compliance: ComplianceConfigSchema.optional(),
    chat: ChatConfigSchema.optional(),
    hf: HfConfigSchema.optional(),
    ops: OpsConfigSchema.optional(),
  })
  .passthrough();

export type AionimaConfig = z.infer<typeof AionimaConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type HfConfig = z.infer<typeof HfConfigSchema>;
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
export type EntityStoreConfig = z.infer<typeof EntityStoreConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type QueueConfig = z.infer<typeof QueueConfigSchema>;
export type SessionsConfig = z.infer<typeof SessionsConfigSchema>;
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
export type PrimeConfig = z.infer<typeof PrimeConfigSchema>;
/** @deprecated Use PrimeConfig. */
export type NexusConfig = z.infer<typeof LegacyNexusConfigSchema>;
export type OwnerConfig = z.infer<typeof OwnerConfigSchema>;
export type HostingConfig = z.infer<typeof HostingConfigSchema>;
export type OwnerChannels = z.infer<typeof OwnerChannelsSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type WorkerModelOverride = z.infer<typeof WorkerModelOverrideSchema>;
export type ProviderCredential = z.infer<typeof ProviderCredentialSchema>;
export type PluginPreference = z.infer<typeof PluginPreferenceSchema>;
export type ServiceOverride = z.infer<typeof ServiceOverrideSchema>;
export type ServicesConfig = z.infer<typeof ServicesConfigSchema>;
export type WorkersConfig = z.infer<typeof WorkersConfigSchema>;
export type MarketplaceConfig = z.infer<typeof MarketplaceConfigSchema>;
export type DevConfig = z.infer<typeof DevConfigSchema>;
export type DashboardAuthConfig = z.infer<typeof DashboardAuthConfigSchema>;
export type AgentCredentialsConfig = z.infer<typeof AgentCredentialsConfigSchema>;
export type FederationConfig = z.infer<typeof FederationConfigSchema>;
export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;
export type IdServiceConfig = z.infer<typeof IdServiceConfigSchema>;
export type IdServiceLocalConfig = z.infer<typeof IdServiceLocalSchema>;
export type BackupConfig = z.infer<typeof BackupConfigSchema>;
export type ComplianceConfig = z.infer<typeof ComplianceConfigSchema>;
export type ChatConfig = z.infer<typeof ChatConfigSchema>;
export type RouterConfig = z.infer<typeof RouterConfigSchema>;
export type CostMode = z.infer<typeof CostModeSchema>;
export type OpsConfig = z.infer<typeof OpsConfigSchema>;
export type AionMicroConfig = z.infer<typeof AionMicroConfigSchema>;
