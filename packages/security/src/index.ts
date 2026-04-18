/**
 * @agi/security — Security scanning framework for the Aionima platform.
 *
 * Provides types, registry, persistence, and built-in scanners for SAST,
 * SCA, secrets detection, and configuration hardening checks.
 */

// Types
export type {
  FindingSeverity,
  FindingConfidence,
  ScanType,
  ScanStatus,
  FindingStatus,
  FindingEvidence,
  FindingRemediation,
  StandardsMapping,
  SecurityFinding,
  ScanConfig,
  ScannerRunResult,
  ScanRun,
  ScanProviderContext,
  ScanProviderHandler,
  ScanProviderDefinition,
  SecuritySummary,
} from "./types.js";

// Registry
export { ScanProviderRegistry } from "./scan-registry.js";
export type { RegisteredScanProvider } from "./scan-registry.js";

// Store
export { ScanStore } from "./scan-store.js";

// Runner
export { ScanRunner } from "./scan-runner.js";

// Built-in scanners
export { sastScanner, scaScanner, secretsScanner, configScanner } from "./scanners/index.js";
