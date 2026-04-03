export type {
  COAFingerprint,
  COAWorkType,
  COARecord,
  ChainMeta,
} from "./types.js";

export { formatFingerprint, parseFingerprint, nextChainId, nextWorkId } from "./format.js";

export type { LogEntryParams, COAChainRow } from "./logger.js";
export { COAChainLogger } from "./logger.js";

// Phase 4 — Cross-Node COA Verification
export type {
  COAHashContent,
  HashedCOARecord,
  CreateHashedRecordParams,
} from "./hash-chain.js";
export {
  canonicalize,
  hashContent,
  HashChainBuilder,
  signCOAHash,
  verifyCOASignature,
} from "./hash-chain.js";

export type {
  RecordVerification,
  ChainVerificationReport,
  ChainGap,
  VerifyChainOptions,
} from "./chain-verifier.js";
export {
  verifyChain,
  verifyRecordHash,
  verifyRecordSignature,
} from "./chain-verifier.js";

export type {
  COAChainStore,
  EntityConsentChecker,
  COAChainRequest,
  COAChainResponse,
  COAChainError,
  COAChainResult,
} from "./coa-api.js";
export { handleCOAChainRequest } from "./coa-api.js";

export type {
  VerificationVote,
  CoVerificationRequest,
  CoVerificationResponse,
  CoVerificationClaim,
  TrustUpgradeCheck,
} from "./co-verification.js";
export {
  DEFAULT_THRESHOLD,
  DEFAULT_DEADLINE_HOURS,
  TRUST_UPGRADE_MIN_DAYS,
  TRUST_UPGRADE_MIN_VERIFICATIONS,
  CoVerificationManager,
} from "./co-verification.js";
