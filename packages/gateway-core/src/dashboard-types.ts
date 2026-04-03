/**
 * Impact Dashboard Types — Task #149
 *
 * API request/response types for the impact dashboard.
 * Endpoints:
 *   /api/dashboard/overview    — total $imp, tier, recent activity
 *   /api/dashboard/timeline    — impact over time (bucketed)
 *   /api/dashboard/breakdown   — by domain, channel, work type
 *   /api/dashboard/leaderboard — opt-in community ranking
 *   /api/dashboard/entity/:id  — single entity profile
 *   /api/dashboard/coa         — COA chain explorer
 */

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

/** Time bucket granularity for timeline queries. */
export type TimeBucket = "hour" | "day" | "week" | "month";

/** Impactinomics domain classification. */
export type ImpactDomain =
  | "governance"
  | "community"
  | "innovation"
  | "operations"
  | "knowledge"
  | "technology";

/** Pagination parameters. */
export interface PaginationParams {
  limit: number;
  offset: number;
}

/** Paginated response wrapper. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** GET /api/dashboard/overview */
export interface DashboardOverview {
  /** Total $imp across all entities. */
  totalImp: number;
  /** Total $imp in the rolling window (default 90 days). */
  windowImp: number;
  /** Total unique entities with impact records. */
  entityCount: number;
  /** Total interactions recorded. */
  interactionCount: number;
  /** Average $imp per interaction. */
  avgImpPerInteraction: number;
  /** Most active channel by interaction count. */
  topChannel: string | null;
  /** Recent activity feed. */
  recentActivity: ActivityEntry[];
  /** Snapshot timestamp. */
  computedAt: string;
}

/** A single activity entry in the overview feed. */
export interface ActivityEntry {
  id: string;
  entityId: string;
  entityName: string;
  channel: string | null;
  workType: string | null;
  impScore: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** GET /api/dashboard/timeline?bucket=day&entityId=...&since=...&until=... */
export interface TimelineParams {
  bucket: TimeBucket;
  entityId?: string;
  since?: string;
  until?: string;
}

/** A single time bucket in the timeline. */
export interface TimelineBucket {
  /** Bucket start (ISO-8601). */
  bucketStart: string;
  /** Total $imp in this bucket. */
  totalImp: number;
  /** Positive $imp in this bucket. */
  positiveImp: number;
  /** Negative $imp in this bucket. */
  negativeImp: number;
  /** Number of interactions in this bucket. */
  interactionCount: number;
}

/** Timeline response. */
export interface TimelineResponse {
  buckets: TimelineBucket[];
  bucket: TimeBucket;
  since: string;
  until: string;
}

// ---------------------------------------------------------------------------
// Breakdown
// ---------------------------------------------------------------------------

/** GET /api/dashboard/breakdown?by=domain|channel|workType&entityId=... */
export type BreakdownDimension = "domain" | "channel" | "workType";

export interface BreakdownParams {
  by: BreakdownDimension;
  entityId?: string;
  since?: string;
  until?: string;
}

/** A single slice in a breakdown. */
export interface BreakdownSlice {
  /** Dimension value (e.g. "telegram", "governance"). */
  key: string;
  /** Total $imp for this slice. */
  totalImp: number;
  /** Interaction count for this slice. */
  count: number;
  /** Percentage of total. */
  percentage: number;
}

/** Breakdown response. */
export interface BreakdownResponse {
  dimension: BreakdownDimension;
  slices: BreakdownSlice[];
  total: number;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/** GET /api/dashboard/leaderboard?window=90d&limit=25 */
export interface LeaderboardParams {
  /** Rolling window in days (default: 90). */
  windowDays?: number;
  limit?: number;
  offset?: number;
}

/** A single entry on the leaderboard. */
export interface LeaderboardEntry {
  entityId: string;
  entityName: string;
  verificationTier: string;
  totalImp: number;
  windowImp: number;
  currentBonus: number;
  rank: number;
}

/** Leaderboard response. */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  windowDays: number;
  total: number;
  computedAt: string;
}

// ---------------------------------------------------------------------------
// Entity Profile
// ---------------------------------------------------------------------------

/** GET /api/dashboard/entity/:id */
export interface EntityImpactProfile {
  entityId: string;
  entityName: string;
  entityType: string;
  verificationTier: string;
  coaAlias: string;
  /** Lifetime $imp total. */
  lifetimeImp: number;
  /** Rolling window $imp. */
  windowImp: number;
  /** Current 0BONUS multiplier. */
  currentBonus: number;
  /** Distinct work types recorded. */
  distinctEventTypes: number;
  /** Domain breakdown for this entity. */
  domainBreakdown: BreakdownSlice[];
  /** Channel breakdown for this entity. */
  channelBreakdown: BreakdownSlice[];
  /** Recent interactions (paginated). */
  recentActivity: ActivityEntry[];
  /** Skills authored count (placeholder for Phase 3+). */
  skillsAuthored: number;
  /** Recognitions received (placeholder for Phase 3+). */
  recognitionsReceived: number;
  /** Privacy: what fields are publicly visible. */
  publicFields: string[];
}

// ---------------------------------------------------------------------------
// COA Explorer
// ---------------------------------------------------------------------------

/** GET /api/dashboard/coa?entityId=...&fingerprint=...&since=...&limit=... */
export interface COAExplorerParams {
  entityId?: string;
  fingerprint?: string;
  workType?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

/** A COA chain record for explorer display. */
export interface COAExplorerEntry {
  fingerprint: string;
  resourceId: string;
  entityId: string;
  entityName: string;
  nodeId: string;
  chainCounter: number;
  workType: string;
  ref: string | null;
  action: string | null;
  payloadHash: string | null;
  createdAt: string;
  /** Associated $imp score if any. */
  impScore: number | null;
}

/** COA explorer response. */
export interface COAExplorerResponse {
  entries: COAExplorerEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Real-time Events (WebSocket)
// ---------------------------------------------------------------------------

/** Project activity event payload. */
export interface ProjectActivityData {
  projectPath: string;
  type: "invocation_start" | "invocation_complete" | "tool_used" | "plan_updated" | "tynn_synced";
  summary: string;
}

/** System upgrade event payload. */
export interface SystemUpgradeData {
  phase: string;
  message: string;
  timestamp: string;
  step?: string;
  status?: string;
}

/** Hosting infrastructure status. */
export interface HostingStatusData {
  ready: boolean;
  caddy: { installed: boolean; running: boolean };
  dnsmasq: { installed: boolean; running: boolean; configured: boolean };
  podman: { installed: boolean; rootless: boolean };
  projects: HostedProjectStatus[];
}

/** Runtime status of a single hosted project. */
export interface HostedProjectStatus {
  path: string;
  hostname: string;
  type: string;
  status: "running" | "stopped" | "error" | "unconfigured";
  port: number | null;
  url: string | null;
  mode: "production" | "development";
  internalPort: number | null;
  containerName?: string;
  image?: string;
  error?: string;
}

/** Worker job update event payload. */
export interface BotsJobUpdateData {
  jobId: string;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  description: string;
  currentPhase: string | null;
  workers: string[];
}

/** Worker completion event payload. */
export interface BotsWorkerDoneData {
  jobId: string;
  workerTid: string;
  worker: string;
  status: string;
  summary: string;
}

/** Worker phase completion event payload. */
export interface BotsPhaseDoneData {
  jobId: string;
  phaseId: string;
  gate: string;
}

/** Worker checkpoint event payload. */
export interface BotsCheckpointData {
  jobId: string;
  phaseId: string;
  gate: string;
}

/** Worker report ready event payload. */
export interface BotsReportReadyData {
  jobId: string;
  coaReqId: string;
  fileCount: number;
  gist: string;
}

/** Worker job failure event payload. */
export interface BotsJobFailedData {
  jobId: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

/** Summary of a single report (for list views). */
export interface ReportSummary {
  coaReqId: string;
  gist: string;
  fileCount: number;
  project: { path: string; name: string } | null;
  workers: string[];
  totalTokens: number;
  costEstimate: number;
  durationMs: number;
  createdAt: string;
}

/** A single file within a report. */
export interface ReportFile {
  filename: string;
  content: string;
}

/** Burn data for a report. */
export interface BurnData {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  durationMs: number;
  workers: BurnWorkerEntry[];
}

/** Per-worker burn entry. */
export interface BurnWorkerEntry {
  worker: string;
  workerTid: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolLoops: number;
  durationMs: number;
}

/** Full detail of a single report. */
export interface ReportDetail {
  coaReqId: string;
  gist: string;
  project: { path: string; name: string } | null;
  workers: string[];
  createdAt: string;
  files: ReportFile[];
  burn: BurnData;
}

/** Notification event payload (real-time push to dashboard). */
export interface NotificationData {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: unknown;
  createdAt: string;
}

/** Update-check payload for WebSocket push (mirrors frontend UpdateCheck). */
export interface UpdateCheckData {
  updateAvailable: boolean;
  localCommit: string;
  remoteCommit: string;
  behindCount: number;
  commits: { hash: string; message: string }[];
}

/** Events broadcast to dashboard WebSocket subscribers. */
export type DashboardEvent =
  | { type: "impact:recorded"; data: ActivityEntry }
  | { type: "entity:verified"; data: { entityId: string; tier: string } }
  | { type: "coa:created"; data: COAExplorerEntry }
  | { type: "overview:updated"; data: DashboardOverview }
  | { type: "project:activity"; data: ProjectActivityData & { timestamp: string } }
  | { type: "system:upgrade"; data: SystemUpgradeData }
  | { type: "system:update_available"; data: UpdateCheckData }
  | { type: "hosting:status"; data: HostingStatusData }
  | { type: "bots:job_update"; data: BotsJobUpdateData }
  | { type: "worker:done"; data: BotsWorkerDoneData }
  | { type: "bots:phase_done"; data: BotsPhaseDoneData }
  | { type: "bots:checkpoint"; data: BotsCheckpointData }
  | { type: "bots:report_ready"; data: BotsReportReadyData }
  | { type: "bots:job_failed"; data: BotsJobFailedData }
  | { type: "notification:new"; data: NotificationData };

/** Dashboard WebSocket subscription message. */
export interface DashboardSubscription {
  type: "dashboard:subscribe";
  channels?: string[];
  entityIds?: string[];
}
