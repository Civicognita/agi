export type {
  EntityDomain,
  EntitySubtype,
  ResourceSubtype,
  NodeSubtype,
  ClassificationSubtype,
  VerificationTier,
  Entity,
  ChannelAccount,
} from "./types.js";

// Database client — re-exported for callers that import from @agi/entity-model
export { createDbClient } from "@agi/db-schema/client";
export type { Db as Database } from "@agi/db-schema/client";

export { EntityStore } from "./store.js";

export type {
  BoolLabel,
  RecordImpactParams,
  ImpactInteraction,
} from "./impact.js";
export { BOOL_VALUES, ImpactRecorder } from "./impact.js";

export {
  lookupQuant,
  getQuantTable,
  isKnownWorkType,
  UNCLASSIFIED_CHANNEL,
} from "./quant-table.js";

export {
  classifyTier1,
  classify,
} from "./bool-classifier.js";
export type {
  ClassificationContext,
  ClassificationResult,
  LLMClassifier,
} from "./bool-classifier.js";

export { ImpactScorer } from "./impact-scorer.js";
export type {
  ScoreInteractionParams,
  ScoringResult,
  BonusConfig,
} from "./impact-scorer.js";

export type {
  VerificationStatus,
  VerificationEntityType,
  VerificationProof,
  VerificationRequest,
  EntitySeal,
  SealAlignment,
  ReviewDecision,
  SealIssuanceParams,
  RevocationParams,
  AutonomyLevel,
  ProofType,
} from "./verification-types.js";
export {
  SEAL_MIN_ALIGNMENT,
  tierRank,
  meetsMinimumTier,
  resolveAutonomy,
} from "./verification-types.js";

export { VerificationManager } from "./verification.js";

export type {
  QueueDirection,
  QueueStatus,
  QueueMessage,
  EnqueueParams,
} from "./queue.js";
export { MessageQueue } from "./queue.js";

export type { CommsLogEntry, CommsLogParams } from "./comms-log.js";
export { CommsLog } from "./comms-log.js";

export type { Notification, CreateNotificationParams } from "./notification-store.js";
export { NotificationStore } from "./notification-store.js";

// Phase 3 — Multi-Entity Governance
export { GovernanceManager, roleOutranks, getRoleCapabilities } from "./governance.js";
export type {
  MemberRole,
  MembershipStatus,
  Membership,
  ImpactPoolEntry,
  OrgImpactSummary,
  RoleCapabilities,
} from "./governance.js";

// Phase 4 — Tier Classification & Governance Voting
export type {
  GovernanceTier,
  TierThresholds,
  TierInput,
  TierClassification,
  NextTierGap,
} from "./tier-engine.js";
export {
  TIER_NAMES,
  DEFAULT_THRESHOLDS,
  classifyTier,
  classifyTiers,
  tierVotingWeight,
} from "./tier-engine.js";

export type {
  ProposalType,
  ProposalStatus,
  ApprovalRequirements,
  Proposal,
  CreateProposalParams,
  VoteTally,
  VoteDecision,
} from "./proposals.js";
export {
  PROPOSAL_TYPE_NAMES,
  APPROVAL_REQUIREMENTS,
  ProposalManager,
  evaluateVotes,
} from "./proposals.js";

export type {
  Vote,
  CastVoteParams,
  SunsetMilestone,
} from "./voting.js";
export {
  VoteManager,
  checkSunsetMilestones,
  SUNSET_MILESTONES,
} from "./voting.js";

export type {
  Constitution,
  ConstitutionTierSection,
  ConstitutionProposalSection,
  ConstitutionVotingSection,
  ConstitutionSunsetSection,
  ConstitutionAmendmentSection,
} from "./constitution.js";
export {
  GENESIS_CONSTITUTION,
  validateConstitution,
} from "./constitution.js";

// Phase 4 — Impact Exchange & Marketplace
export type {
  RecognitionEvent,
  RecognitionDomain,
  RecognitionStatus,
  CreateRecognitionParams,
} from "./recognition.js";
export {
  RECOGNITION_BONUS,
  RecognitionManager,
} from "./recognition.js";

export type {
  AlignmentBond,
  BondStatus,
  ProposeBondParams,
  BondHistoryEntry,
} from "./bonding.js";
export {
  ALIGNMENT_BONUS_MULTIPLIER,
  BondingManager,
} from "./bonding.js";

export type {
  SkillVerificationStatus,
  SkillListing,
  SkillUsageStats,
  SkillEndorsement,
  SubmitSkillParams,
} from "./marketplace.js";
export { MarketplaceManager } from "./marketplace.js";

export type {
  RankingWeights,
  RankingScore,
  RankingContext,
} from "./marketplace-ranking.js";
export {
  DEFAULT_RANKING_WEIGHTS,
  rankSkills,
  computeScore,
} from "./marketplace-ranking.js";

// Phase 4 — Multi-Tenancy
export type {
  TenantId,
  PlanTier,
  Tenant,
  PlanLimits,
} from "./tenant.js";
export {
  DEFAULT_TENANT,
  PLAN_LIMITS,
  createTenantId,
  getPlanLimits,
  isOverEntityLimit,
  isOverChannelLimit,
} from "./tenant.js";

export type {
  Row,
  MutationResult,
  DatabaseAdapter,
  DatabaseBackend,
  PostgresConfig,
  CreateDatabaseOptions,
} from "./database.js";
export { SQLiteAdapter, PostgresAdapter, createDatabaseAdapter } from "./database.js";

export { migrateToPostgres, estimateMigration } from "./migration.js";
export type {
  MigrationConfig,
  MigrationProgress,
  MigrationResult,
  TableMigrationResult,
  ValidationError,
} from "./migration.js";

// Phase 4 — Federation (GEID)
export type { GEID, EntityKeypair, IdentityStatement, GEIDMapping, FederationConsent } from "./geid.js";
export {
  GEID_PREFIX,
  generateEntityKeypair,
  deriveGEID,
  isValidGEID,
  extractPublicKeyBase58,
  signIdentityStatement,
  verifyIdentityStatement,
  publicKeyFromGEID,
} from "./geid.js";

// Phase 4 — Federation (Entity Map)
export type {
  EntityMap,
  EntityMapPersona,
  EntityMapImpact,
  EntityMapChannel,
  EntityMapHomeNode,
  GenerateEntityMapParams,
} from "./entity-map.js";
export {
  generateEntityMap,
  verifyEntityMapSignature,
  verifyEntityMapEndorsement,
  isEntityMapExpired,
  verifyEntityMap,
} from "./entity-map.js";

// Phase 4 — Federation (COA Address)
export type { COAAddress } from "./geid.js";
export { formatAddress, parseAddress } from "./geid.js";

// Phase 4 — GDPR Compliance
export type {
  DeletionPhase,
  DeletionRequest,
  PhaseLogEntry,
  DeletionReport,
  GDPRConfig,
} from "./gdpr.js";
export { GDPRManager } from "./gdpr.js";

// Compliance — Incidents, Consent, Vendors, Sessions, Usage
export type { CryptoProvider } from "./crypto.js";
export { createCryptoProvider } from "./crypto.js";

export type { Incident, CreateIncidentParams, IncidentSeverity, IncidentStatus, BreachClassification } from "./incident-store.js";
export { IncidentStore } from "./incident-store.js";

export type { ConsentRecord, ConsentPurpose } from "./consent-store.js";
export { ConsentStore } from "./consent-store.js";

export type { Vendor, CreateVendorParams, VendorType, ComplianceStatus } from "./vendor-store.js";
export { VendorStore } from "./vendor-store.js";

export type { Session } from "./session-store.js";
export { SessionStore } from "./session-store.js";

export type { UsageRecord, RecordUsageParams, UsageSummary, ProjectCost } from "./usage-store.js";
export { UsageStore, estimateCost } from "./usage-store.js";

export { PRICING, MODEL_TIERS, getModelsForMode, getDefaultModelForMode } from "./model-pricing.js";
export type { CostMode, ModelTier } from "./model-pricing.js";
