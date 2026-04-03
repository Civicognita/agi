/**
 * Protocol Stability Review — Task #224
 *
 * Reviews all /fed/v1 endpoints for breaking change risks.
 * Documents API versioning strategy.
 * Assesses governance milestone readiness.
 * Produces stability report with go/no-go recommendation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stability classification for an endpoint. */
export type StabilityStatus = "stable" | "experimental" | "deprecated";

/** Breaking change risk level. */
export type BreakingChangeRisk = "none" | "low" | "medium" | "high";

/** Endpoint stability entry. */
export interface EndpointStability {
  /** HTTP method. */
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Endpoint path. */
  path: string;
  /** Current stability status. */
  status: StabilityStatus;
  /** Breaking change risk. */
  breakingChangeRisk: BreakingChangeRisk;
  /** Minimum trust level required. */
  minTrustLevel: number;
  /** Known issues or concerns. */
  notes: string[];
  /** Protocol version this endpoint was introduced. */
  sinceVersion: string;
}

/** Governance milestone assessment. */
export interface MilestoneAssessment {
  milestoneId: string;
  name: string;
  /** Required thresholds. */
  requirements: Record<string, number>;
  /** Current values (may be simulated in pre-launch). */
  currentValues: Record<string, number>;
  /** Whether milestone is met. */
  met: boolean;
  /** Gaps to meeting milestone. */
  gaps: string[];
}

/** Full stability report. */
export interface StabilityReport {
  /** Report generation timestamp. */
  generatedAt: string;
  /** Protocol version being reviewed. */
  protocolVersion: string;
  /** Overall recommendation. */
  recommendation: "go" | "no-go" | "conditional";
  /** Summary of findings. */
  summary: string;
  /** Endpoint-level stability. */
  endpoints: EndpointStability[];
  /** Versioning strategy. */
  versioningStrategy: VersioningStrategy;
  /** Milestone assessments. */
  milestones: MilestoneAssessment[];
  /** Open issues blocking go. */
  blockers: string[];
  /** Warnings (non-blocking). */
  warnings: string[];
}

/** API versioning strategy. */
export interface VersioningStrategy {
  /** Versioning approach. */
  approach: "path-based";
  /** Current version. */
  currentVersion: string;
  /** Planned next version. */
  nextVersion: string;
  /** Migration path for breaking changes. */
  migrationPolicy: string;
  /** Deprecation notice period (days). */
  deprecationNoticeDays: number;
  /** How long old versions are supported after deprecation. */
  sunsetPeriodDays: number;
}

// ---------------------------------------------------------------------------
// Federation endpoint registry
// ---------------------------------------------------------------------------

/** Registry of all /fed/v1 endpoints and their stability status. */
export const FEDERATION_ENDPOINTS: EndpointStability[] = [
  {
    method: "POST",
    path: "/fed/v1/peer/hello",
    status: "stable",
    breakingChangeRisk: "none",
    minTrustLevel: 0,
    notes: ["Core handshake — must remain stable"],
    sinceVersion: "v1",
  },
  {
    method: "GET",
    path: "/fed/v1/entities/:geid",
    status: "stable",
    breakingChangeRisk: "low",
    minTrustLevel: 1,
    notes: ["May add optional fields to response"],
    sinceVersion: "v1",
  },
  {
    method: "POST",
    path: "/fed/v1/coa/submit",
    status: "stable",
    breakingChangeRisk: "low",
    minTrustLevel: 2,
    notes: ["Batch size limits may change"],
    sinceVersion: "v1",
  },
  {
    method: "GET",
    path: "/fed/v1/coa/:fingerprint",
    status: "stable",
    breakingChangeRisk: "none",
    minTrustLevel: 1,
    notes: ["Read-only, safe to extend"],
    sinceVersion: "v1",
  },
  {
    method: "POST",
    path: "/fed/v1/peer/verify",
    status: "experimental",
    breakingChangeRisk: "medium",
    minTrustLevel: 2,
    notes: [
      "Co-verification protocol may evolve",
      "Threshold and deadline params subject to change",
    ],
    sinceVersion: "v1",
  },
  {
    method: "POST",
    path: "/fed/v1/governance/vote",
    status: "stable",
    breakingChangeRisk: "low",
    minTrustLevel: 1,
    notes: ["Vote weight calculation may be refined"],
    sinceVersion: "v1",
  },
  {
    method: "GET",
    path: "/fed/v1/governance/active",
    status: "stable",
    breakingChangeRisk: "none",
    minTrustLevel: 1,
    notes: ["Read-only"],
    sinceVersion: "v1",
  },
  {
    method: "POST",
    path: "/fed/v1/governance/emergency",
    status: "experimental",
    breakingChangeRisk: "medium",
    minTrustLevel: 3,
    notes: [
      "Anchor quorum rules may change",
      "Emergency change types may be expanded",
    ],
    sinceVersion: "v1",
  },
];

// ---------------------------------------------------------------------------
// Versioning strategy
// ---------------------------------------------------------------------------

export const VERSIONING_STRATEGY: VersioningStrategy = {
  approach: "path-based",
  currentVersion: "v1",
  nextVersion: "v2",
  migrationPolicy:
    "Breaking changes will be introduced in /fed/v2. " +
    "Both v1 and v2 will run in parallel during the migration period. " +
    "Clients should migrate within the sunset period.",
  deprecationNoticeDays: 90,
  sunsetPeriodDays: 180,
};

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/**
 * Generate a protocol stability report.
 */
export function generateStabilityReport(
  milestoneData?: {
    tier2PlusVoters?: number;
    activeNodes?: number;
  },
): StabilityReport {
  const now = new Date().toISOString();
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Evaluate endpoints
  const highRiskEndpoints = FEDERATION_ENDPOINTS.filter(
    e => e.breakingChangeRisk === "high",
  );
  const experimentalEndpoints = FEDERATION_ENDPOINTS.filter(
    e => e.status === "experimental",
  );

  if (highRiskEndpoints.length > 0) {
    blockers.push(
      `${highRiskEndpoints.length} endpoint(s) with HIGH breaking change risk`,
    );
  }

  if (experimentalEndpoints.length > 0) {
    warnings.push(
      `${experimentalEndpoints.length} experimental endpoint(s): ${experimentalEndpoints.map(e => e.path).join(", ")}`,
    );
  }

  // Milestone 1 assessment
  const tier2Plus = milestoneData?.tier2PlusVoters ?? 0;
  const nodes = milestoneData?.activeNodes ?? 0;

  const milestone1: MilestoneAssessment = {
    milestoneId: "M1",
    name: "Governance Milestone 1 — First Independent Governance",
    requirements: {
      tier2PlusVoters: 500,
      activeNodes: 5,
    },
    currentValues: {
      tier2PlusVoters: tier2Plus,
      activeNodes: nodes,
    },
    met: tier2Plus >= 500 && nodes >= 5,
    gaps: [],
  };

  if (tier2Plus < 500) {
    milestone1.gaps.push(
      `Need ${500 - tier2Plus} more Tier 2+ voters (have ${tier2Plus})`,
    );
  }
  if (nodes < 5) {
    milestone1.gaps.push(
      `Need ${5 - nodes} more active nodes (have ${nodes})`,
    );
  }

  // Milestone 2 assessment
  const milestone2: MilestoneAssessment = {
    milestoneId: "M2",
    name: "Governance Milestone 2 — Full Community Governance",
    requirements: {
      tier2PlusVoters: 2000,
      activeNodes: 10,
    },
    currentValues: {
      tier2PlusVoters: tier2Plus,
      activeNodes: nodes,
    },
    met: tier2Plus >= 2000 && nodes >= 10,
    gaps: [],
  };

  if (tier2Plus < 2000) {
    milestone2.gaps.push(
      `Need ${2000 - tier2Plus} more Tier 2+ voters (have ${tier2Plus})`,
    );
  }
  if (nodes < 10) {
    milestone2.gaps.push(
      `Need ${10 - nodes} more active nodes (have ${nodes})`,
    );
  }

  // Generate recommendation
  let recommendation: "go" | "no-go" | "conditional";
  if (blockers.length > 0) {
    recommendation = "no-go";
  } else if (warnings.length > 0) {
    recommendation = "conditional";
  } else {
    recommendation = "go";
  }

  const summary =
    recommendation === "go"
      ? "All federation endpoints are stable. No breaking changes planned."
      : recommendation === "conditional"
        ? "Protocol is conditionally stable. Experimental endpoints may change."
        : "Protocol stability review found blockers that must be resolved.";

  return {
    generatedAt: now,
    protocolVersion: "v1",
    recommendation,
    summary,
    endpoints: [...FEDERATION_ENDPOINTS],
    versioningStrategy: { ...VERSIONING_STRATEGY },
    milestones: [milestone1, milestone2],
    blockers,
    warnings,
  };
}
