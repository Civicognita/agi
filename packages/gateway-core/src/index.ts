export type { GatewayState, GatewayConfig } from "./types.js";

// Logger
export { createLogger, createComponentLogger } from "./logger.js";
export type { Logger, ComponentLogger, LoggerConfig, LogEntry } from "./logger.js";

// Gateway bootstrap
export { startGatewayServer } from "./server.js";
export type { GatewayServer, GatewayServerOptions } from "./server.js";

export { createGatewayRuntimeState } from "./server-runtime-state.js";
export type { GatewayRuntimeState, RuntimeStateDeps, RuntimeStateOptions, ReloadResult } from "./server-runtime-state.js";

export { startGatewaySidecars } from "./server-startup.js";
export type { GatewaySidecarsResult, GatewaySidecarsDeps, GatewaySidecarsOptions } from "./server-startup.js";

export type { StateCapabilities, StateTransition } from "./state-machine.js";
export { GatewayStateMachine } from "./state-machine.js";

export { GatewayWebSocketServer } from "./ws-server.js";
export type {
  ConnectionMeta,
  WSMessage,
  GatewayWSServerOptions,
} from "./ws-server.js";

export { InboundRouter } from "./inbound-router.js";
export type { InboundRouterDeps, InboundResult, OutboundSender } from "./inbound-router.js";

export { PairingStore } from "./pairing-store.js";
export type {
  PairingRequest as DmPairingRequest,
  PairedUser,
  PairingStoreConfig,
} from "./pairing-store.js";

export { ChannelRegistry } from "./channel-registry.js";
export type { ChannelStatus, ChannelEntry } from "./channel-registry.js";

export { OutboundDispatcher } from "./outbound-dispatcher.js";
export type {
  OutboundDispatcherDeps,
  OutboundRoute,
  OutboundResult,
  OutboundBatchResult,
  OutboundError,
} from "./outbound-dispatcher.js";

export { QueueConsumer } from "./queue-consumer.js";
export type {
  QueueConsumerDeps,
  QueueConsumerOptions,
  ConsumerStats,
} from "./queue-consumer.js";

// Phase 2 — Autonomous Agent
export {
  assembleSystemPrompt,
  computeAvailableTools,
  getTierCapabilities,
  estimateTokens,
} from "./system-prompt.js";
export type {
  EntityContextSection,
  ToolManifestEntry,
  TierCapabilities,
  SystemPromptContext,
  PrimeContext,
} from "./system-prompt.js";

// PRIME Knowledge Corpus
export { PrimeLoader } from "./prime-loader.js";
export type { PrimeEntry } from "./prime-loader.js";

export { AnthropicClient } from "./anthropic-client.js";
export type {
  AnthropicClientConfig,
  InvokeParams,
  InvokeResult,
  ToolContinuationParams,
} from "./anthropic-client.js";

export { AgentSessionManager } from "./agent-session.js";
export type {
  ConversationTurn,
  AgentSession,
  SessionManagerConfig,
  HistoryAssemblyResult,
  MemoryExtraction,
} from "./agent-session.js";

export { gateInvocation, isHumanCommand } from "./invocation-gate.js";
export type { InvocationDecision } from "./invocation-gate.js";

export { sanitize, scanToolResult, capToolResult } from "./sanitizer.js";
export type {
  SanitizationLimits,
  SanitizedContent,
  InjectionScanResult,
} from "./sanitizer.js";

export { RateLimiter } from "./rate-limiter.js";
export type {
  RateLimitEntry,
  RateLimitConfig,
  RateLimitResult,
} from "./rate-limiter.js";

export { ToolRegistry } from "./tool-registry.js";
export type {
  ToolHandler,
  RegisteredTool,
  ToolExecutionResult,
  ToolExecutionContext,
  TaskmasterEmission,
} from "./tool-registry.js";

export { AgentInvoker } from "./agent-invoker.js";
export type {
  AgentInvokerDeps,
  InvocationRequest,
  InvocationOutcome,
} from "./agent-invoker.js";

// Phase 2 — Session Management & Security
export { SessionStore } from "./session-store.js";
export type {
  SessionKeyParts,
  SessionRecord,
  SessionStoreConfig,
  SessionStoreStats,
} from "./session-store.js";

export { TranscriptManager } from "./session-transcript.js";
export type {
  TranscriptLine,
  TranscriptHeader,
  TranscriptLoadResult,
  TranscriptConfig,
} from "./session-transcript.js";

export { GatewayAuth } from "./auth.js";
export type {
  AuthConfig,
  AuthResult,
} from "./auth.js";

// Phase 3 — Impact Dashboard
export { DashboardQueries } from "./dashboard-queries.js";
export { DashboardApi } from "./dashboard-api.js";
export type { DashboardApiDeps } from "./dashboard-api.js";
export { DashboardEventBroadcaster } from "./dashboard-events.js";
export type {
  DashboardEventsDeps,
  DashboardBroadcaster,
} from "./dashboard-events.js";

export type {
  TimeBucket,
  ImpactDomain,
  BreakdownDimension,
  DashboardOverview,
  ActivityEntry,
  TimelineParams,
  TimelineBucket,
  TimelineResponse,
  BreakdownSlice,
  BreakdownResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  EntityImpactProfile,
  COAExplorerEntry,
  COAExplorerResponse,
  DashboardEvent,
  DashboardSubscription,
  BotsJobUpdateData,
  NotificationData,
} from "./dashboard-types.js";

// Phase 3 — 0R Seal Issuance (Ed25519)
export { SealSigner, generateKeypair, verifySignature, canonicalize } from "./seal-signer.js";
export type {
  SealPayload,
  SignedSeal,
  SealSignerConfig,
} from "./seal-signer.js";

export { verifySealWebCrypto, parseSealBundle } from "./seal-verifier.js";
export type {
  SealVerificationResult,
  SealBundle,
} from "./seal-verifier.js";

export { SealWorkflow } from "./seal-workflow.js";
export type {
  SealIssuanceResult,
  ReviewResult,
  RevocationResult,
  SealWorkflowConfig,
} from "./seal-workflow.js";

// Phase 3 — Canvas / A2UI
export { canvasToPlainText } from "./canvas-types.js";
export type {
  CanvasDocument,
  CanvasSection,
  CanvasSectionType,
  TextSection,
  ChartSection,
  COAChainSection,
  COAChainEntry,
  EntityCardSection,
  SealSection,
  MetricSection,
  TableSection,
  TableColumn,
  FormSection,
  FormField,
  ChartDataPoint,
  ChartSeries,
} from "./canvas-types.js";

export {
  createCanvasToolHandler,
  CANVAS_TOOL_MANIFEST,
  CANVAS_TOOL_INPUT_SCHEMA,
} from "./canvas-tool.js";
export type {
  CanvasEmitInput,
  CanvasEmitResult,
  CanvasEmitHandler,
} from "./canvas-tool.js";

// Phase 4 — Multi-Tenancy & Billing
export { BillingManager, PLAN_PRICING } from "./billing.js";
export type {
  BillingConfig,
  CheckoutParams,
  CheckoutResult,
  SubscriptionInfo,
  SubscriptionStatus,
  WebhookEvent,
  WebhookResult,
  WebhookAction,
  UsageRecord,
  PlanGateResult,
  BillingCallbacks,
} from "./billing.js";

// Phase 4 — Multi-User Sessions
export { SessionManager } from "./session-manager.js";
export type {
  SessionStatus,
  AgentSession as MultiUserSession,
  CreateSessionParams,
  SessionManagerConfig as MultiUserSessionConfig,
  SessionStats,
} from "./session-manager.js";

// Phase 4 — Federation Protocol
export { FederationNode, generateNodeKeypair } from "./federation-node.js";
export type { FederationNodeConfig } from "./federation-node.js";

export type {
  TrustLevel,
  NodeManifest,
  FederationProtocol,
  NodeCapabilities,
  PeerNode,
  DiscoveryMethod,
  HandshakeRequest,
  HandshakeResponse,
  MyceliumSig,
  EntityLookupResponse,
  COARelayRequest,
  COARelayRecord,
  COARelayResponse,
  GovernanceVoteRequest,
  GovernanceVoteResponse,
  FederationError,
  FederationErrorCode,
} from "./federation-types.js";

export {
  handleHandshakeRequest,
  verifyHandshakeResponse,
  createHandshakeRequest,
} from "./federation-handshake.js";
export type { HandshakeResult, HandshakeValidation } from "./federation-handshake.js";

export { FederationRouter } from "./federation-router.js";
export type {
  FederationRequest,
  FederationResponse,
  FederationRouterConfig,
  AuditLogEntry,
  FederationEntityLookup,
  FederationCOARelay,
  FederationCOAChainLookup,
  FederationCoVerification,
  FederationGovernance,
} from "./federation-router.js";

// Phase 4 — Governance API
export { GovernanceApi } from "./governance-api.js";
export type {
  CrossNodeVoteRequest,
  CrossNodeVoteResponse,
  ActiveProposalEntry,
  ActiveProposalsResponse,
  EmergencySessionRequest,
  EmergencySessionResponse,
  GovernanceApiDeps,
} from "./governance-api.js";

// Phase 3 — iOS Companion
export { CompanionPairingService } from "./companion-pairing.js";
export type {
  PairingCode,
  CompanionDevice,
  PairingRequest,
  PairingResult,
  CompanionNotification,
  CompanionNotificationType,
  CompanionToGateway,
  GatewayToCompanion,
  VoiceInputPayload,
  CameraInputPayload,
} from "./companion-types.js";

// Phase 4 — Trust Engine (Trust Level 3 + Anchor)
export { TrustEngine } from "./trust-engine.js";
export type {
  ExtendedTrustLevel,
  EstablishedRequirements,
  TrustEvaluationInput,
  TrustEvaluationResult,
  TrustGap,
  AnchorAppointment,
  EmergencyProtocolChange,
  AnchorApproval,
  AnchorQuorumConfig,
} from "./trust-engine.js";
export {
  TRUST_LEVEL_NAMES,
  DEFAULT_ESTABLISHED_REQUIREMENTS,
  DEFAULT_ANCHOR_QUORUM,
} from "./trust-engine.js";

// Phase 4 — Node Health Monitoring
export { NodeHealthMonitor } from "./node-health.js";
export type {
  HealthCheckResult,
  NodeHealthMetrics,
  QuarantineRecord,
  QuarantineReason,
  NodeAlert,
  AlertSeverity,
  AlertType,
  HealthMonitorConfig,
} from "./node-health.js";

// Phase 4 — Protocol Stability Review
export { generateStabilityReport, FEDERATION_ENDPOINTS, VERSIONING_STRATEGY } from "./protocol-stability.js";
export type {
  StabilityStatus,
  BreakingChangeRisk,
  EndpointStability,
  MilestoneAssessment,
  StabilityReport,
  VersioningStrategy,
} from "./protocol-stability.js";

// Heartbeat Scheduler
export { HeartbeatScheduler } from "./heartbeat.js";
export type { HeartbeatSchedulerDeps } from "./heartbeat.js";

// Phase 4 — Legal Compliance Framework
export {
  TOS_TEMPLATE,
  DPA_TEMPLATE,
  DATA_FLOWS,
  SEAL_POSITIONING,
  getComplianceGaps,
} from "./legal-compliance.js";
export type {
  ComplianceDocType,
  ComplianceDocument,
  ComplianceSection,
  DataFlowRecord,
  SealPositioning,
} from "./legal-compliance.js";

// Plans
export type { Plan, PlanStep, PlanStatus, PlanStepStatus, PlanStepType, PlanStepInput, PlanStepUpdate, PlanTynnRefs, CreatePlanInput, UpdatePlanInput } from "./plan-types.js";
export { PlanStore } from "./plan-store.js";
export { buildTynnSyncPrompt, determineMappingStrategy } from "./plan-tynn-mapper.js";
export type { TynnMappingStrategy, TynnMappingResult, PlanForMapping } from "./plan-tynn-mapper.js";

// Project Types
export { ProjectTypeRegistry, createProjectTypeRegistry, PROJECT_CATEGORIES } from "./project-types.js";
export type { ProjectTypeDefinition, ProjectTypeTool, ContainerConfig, ProjectCategory, LogSourceDefinition } from "./project-types.js";

// Stacks
export { StackRegistry } from "./stack-registry.js";
export type {
  StackCategory, StackRequirement, StackGuide,
  StackContainerContext, StackContainerConfig, StackDatabaseConfig,
  StackScaffoldingConfig, StackInstallAction, StackDevCommands,
  StackDefinition, ProjectStackInstance,
  StackInfo, SharedContainerRecord, SharedContainerInfo,
} from "./stack-types.js";
export { SharedContainerManager } from "./shared-container-manager.js";
export type { SharedContainerManagerDeps } from "./shared-container-manager.js";
export { registerStackRoutes } from "./stack-api.js";
export type { StackApiDeps } from "./stack-api.js";

// Hosting
export { HostingManager } from "./hosting-manager.js";
export type { HostingConfig, ProjectHostingMeta, HostedProject, InfraStatus, HostingManagerDeps, InstallActionResult, DetectedProjectConfig } from "./hosting-manager.js";

// Service Manager
export { ServiceManager } from "./service-manager.js";
export type { ServiceStatus, ServiceManagerDeps } from "./service-manager.js";

// Terminal
export { TerminalManager } from "./terminal-manager.js";
export type { TerminalSession } from "./terminal-manager.js";

// Secrets
export { SecretsManager } from "./secrets.js";

// Phase 5 — Federation Peer Store
export { FederationPeerStore } from "./federation-peer-store.js";

// Phase 5 — Federation Ring Protocol Types
export type {
  RingAnnounceRequest,
  RingAnnounceResponse,
  VisitorChallengeRequest,
  VisitorChallengeResponse,
  VisitorVerifyRequest,
  VisitorVerifyResponse,
} from "./federation-types.js";

export type { FederationEntityMapProvider } from "./federation-router.js";

// Phase 5 — Local Identity Provider
export { IdentityProvider } from "./identity-provider.js";
export type { IdentityProviderConfig, IssuedIdentity, IdentityBindingResult } from "./identity-provider.js";

// Phase 5 — OAuth Handler
export { OAuthHandler } from "./oauth-handler.js";
export type { OAuthProviderConfig, OAuthConfig, OAuthUserInfo } from "./oauth-handler.js";

// Phase 5 — Identity API
export { registerIdentityRoutes } from "./identity-api.js";
export type { IdentityApiDeps } from "./identity-api.js";

// Phase 5 — Visitor Authentication
export { VisitorAuthManager } from "./visitor-auth.js";
export type { VisitorChallenge, VisitorSession, VisitorAuthConfig } from "./visitor-auth.js";

// Phase 5 — Sub-User API
export { registerSubUserRoutes } from "./sub-user-api.js";
export type { SubUserApiDeps } from "./sub-user-api.js";
