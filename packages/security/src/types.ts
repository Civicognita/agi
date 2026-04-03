/**
 * Security scanning types — matches the vulnerability taxonomy and JSON output
 * schema from the security audit prompt specification.
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingConfidence = "high" | "medium" | "low";
export type ScanType = "sast" | "dast" | "sca" | "secrets" | "config" | "container" | "custom";
export type ScanStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type FindingStatus = "open" | "acknowledged" | "mitigated" | "false_positive";

// ---------------------------------------------------------------------------
// Core finding — matches security_findings.json schema
// ---------------------------------------------------------------------------

export interface FindingEvidence {
  file?: string;
  line?: number;
  column?: number;
  snippet?: string;
  context?: string;
  /** SCA: the vulnerable dependency name */
  dependency?: string;
  /** SCA: installed version */
  installedVersion?: string;
  /** SCA: first fixed version */
  fixedVersion?: string;
  /** SCA: CVE identifier */
  cveId?: string;
}

export interface FindingRemediation {
  description: string;
  effort: "low" | "medium" | "high";
  /** Hours until remediation deadline (critical=72, high=168, medium=720, low=2160) */
  slaHours: number;
  references?: string[];
}

export interface StandardsMapping {
  owaspTop10?: string[];
  mitreCwe?: string[];
  nistSp80053?: string[];
  pciDss?: string[];
  gdpr?: string[];
}

export interface SecurityFinding {
  id: string;
  scanId: string;
  title: string;
  description: string;
  /** Detection rule ID (e.g. "SAST-XSS-01", "SCA-CVE-2024-1234") */
  checkId: string;
  scanType: ScanType;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  cwe?: string[];
  owasp?: string[];
  evidence: FindingEvidence;
  remediation: FindingRemediation;
  standards?: StandardsMapping;
  createdAt: string;
  status: FindingStatus;
}

// ---------------------------------------------------------------------------
// Scan configuration
// ---------------------------------------------------------------------------

export interface ScanConfig {
  scanTypes: ScanType[];
  targetPath: string;
  projectId?: string;
  excludePaths?: string[];
  severityThreshold?: FindingSeverity;
  maxFindings?: number;
}

// ---------------------------------------------------------------------------
// Scan run
// ---------------------------------------------------------------------------

export interface ScannerRunResult {
  scannerId: string;
  scanType: ScanType;
  status: ScanStatus;
  findings: SecurityFinding[];
  durationMs: number;
  error?: string;
}

export interface ScanRun {
  id: string;
  status: ScanStatus;
  config: ScanConfig;
  startedAt: string;
  completedAt?: string;
  findingCounts: Record<FindingSeverity, number>;
  totalFindings: number;
  scannerResults: ScannerRunResult[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Scan provider — what plugins and built-in scanners implement
// ---------------------------------------------------------------------------

export interface ScanProviderContext {
  logger: { debug(msg: string): void; info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  workspaceRoot: string;
  abortSignal?: AbortSignal;
}

export type ScanProviderHandler = (
  config: ScanConfig,
  context: ScanProviderContext,
) => Promise<SecurityFinding[]>;

export interface ScanProviderDefinition {
  id: string;
  name: string;
  description?: string;
  scanType: ScanType;
  projectCategories?: string[];
  scan: ScanProviderHandler;
  icon?: string;
}

// ---------------------------------------------------------------------------
// Security summary (for dashboard)
// ---------------------------------------------------------------------------

export interface SecuritySummary {
  totalFindings: number;
  bySeverity: Record<FindingSeverity, number>;
  byStatus: Record<FindingStatus, number>;
  byScanType: Record<ScanType, number>;
  lastScanAt?: string;
  scanCount: number;
}
