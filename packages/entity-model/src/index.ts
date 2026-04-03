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

export {
  CREATE_ENTITIES,
  CREATE_CHANNEL_ACCOUNTS,
  CREATE_COA_CHAINS,
  CREATE_IMPACT_INTERACTIONS,
  CREATE_VERIFICATION_REQUESTS,
  CREATE_SEALS,
  CREATE_MESSAGE_QUEUE,
  CREATE_META,
  CREATE_COMMS_LOG,
  CREATE_NOTIFICATIONS,
  ALL_DDL,
} from "./schema.sql.js";

export type { Database } from "./db.js";
export { createDatabase } from "./db.js";

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

export {
  PG_CREATE_TENANTS,
  PG_CREATE_ENTITIES,
  PG_CREATE_CHANNEL_ACCOUNTS,
  PG_CREATE_COA_CHAINS,
  PG_CREATE_IMPACT_INTERACTIONS,
  PG_CREATE_VERIFICATION_REQUESTS,
  PG_CREATE_SEALS,
  PG_CREATE_MESSAGE_QUEUE,
  PG_CREATE_META,
  PG_CREATE_MEMBERSHIPS,
  PG_CREATE_SESSIONS,
  PG_CREATE_INDEXES,
  PG_ALL_DDL,
  generateRLSPolicies,
} from "./pg-schema.js";

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

// Phase 4 — Federation (GEID DDL for PG)
export const PG_CREATE_GEID_MAPPINGS = `
CREATE TABLE IF NOT EXISTS geid_mappings (
  local_entity_id  TEXT NOT NULL REFERENCES entities(id),
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  geid             TEXT NOT NULL UNIQUE,
  public_key_pem   TEXT NOT NULL,
  discoverable     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, local_entity_id)
)` as const;

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

// Phase 4 — Federation (Schema)
export {
  CREATE_GEID_MAPPINGS,
  CREATE_FEDERATION_PEERS,
  CREATE_ENTITY_MAP_CACHE,
  CREATE_ACCESS_GRANTS,
  FEDERATION_MIGRATIONS,
  COA_MIGRATIONS,
  COA_COMPLIANCE_MIGRATIONS,
} from "./schema.sql.js";

// Phase 4 — GDPR Compliance
export type {
  DeletionPhase,
  DeletionRequest,
  PhaseLogEntry,
  DeletionReport,
  GDPRConfig,
} from "./gdpr.js";
export { GDPRManager } from "./gdpr.js";

// Compliance — Encryption, Incidents, Consent, Vendors, Sessions
export type { CryptoProvider } from "./crypto.js";
export { createCryptoProvider } from "./crypto.js";

export type { Incident, CreateIncidentParams, IncidentSeverity, IncidentStatus, BreachClassification } from "./incident-store.js";
export { IncidentStore, CREATE_INCIDENTS } from "./incident-store.js";

export type { ConsentRecord, ConsentPurpose } from "./consent-store.js";
export { ConsentStore, CREATE_CONSENTS } from "./consent-store.js";

export type { Vendor, CreateVendorParams, VendorType, ComplianceStatus } from "./vendor-store.js";
export { VendorStore, CREATE_VENDORS } from "./vendor-store.js";

export type { Session } from "./session-store.js";
export { SessionStore, CREATE_SESSIONS, CREATE_API_KEYS } from "./session-store.js";

export type { UsageRecord, RecordUsageParams, UsageSummary, ProjectCost } from "./usage-store.js";
export { UsageStore, CREATE_USAGE_LOG, estimateCost } from "./usage-store.js";
