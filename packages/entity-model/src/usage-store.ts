/**
 * UsageStore — LLM token usage and cost tracking per invocation.
 *
 * Persists token counts, estimated USD cost, and project attribution
 * for every completed agent invocation. Enables True Cost per project.
 */

import { ulid } from "ulid";
import type { Database } from "./db.js";
import { estimateCost } from "./model-pricing.js";
export { estimateCost };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageRecord {
  id: string;
  entityId: string;
  projectPath: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  coaFingerprint: string | null;
  toolCount: number;
  loopCount: number;
  createdAt: string;
  /** "chat" for Aion direct turns, "worker" for TaskMaster worker runs. */
  source: "chat" | "worker";
}

export interface RecordUsageParams {
  entityId: string;
  projectPath?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  coaFingerprint?: string;
  toolCount?: number;
  loopCount?: number;
  /** "chat" for Aion direct turns, "worker" for TaskMaster worker runs. Defaults to "chat". */
  source?: "chat" | "worker";
  /** Cost mode used by the AgentRouter (local/economy/balanced/max). */
  costMode?: string;
  /** Whether the AgentRouter escalated to a more capable model. */
  escalated?: boolean;
  /** Original model before escalation (the escalation reason string). */
  originalModel?: string;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  invocationCount: number;
}

export interface ProjectCost {
  projectPath: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  invocationCount: number;
}

/** Per-project + per-source breakdown for the dual-bar chart. */
export interface ProjectSourceCost {
  projectPath: string;
  source: "chat" | "worker";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  invocationCount: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CREATE_USAGE_LOG = `
CREATE TABLE IF NOT EXISTS usage_log (
  id               TEXT NOT NULL PRIMARY KEY,
  entity_id        TEXT NOT NULL,
  project_path     TEXT,
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL NOT NULL DEFAULT 0,
  coa_fingerprint  TEXT,
  tool_count       INTEGER NOT NULL DEFAULT 0,
  loop_count       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
)` as const;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class UsageStore {
  constructor(private readonly db: Database) {
    db.exec(CREATE_USAGE_LOG);
    // Migration: add `source` column for existing installs. SQLite doesn't
    // support ADD COLUMN IF NOT EXISTS, so catch the "duplicate column" error.
    try {
      db.exec(`ALTER TABLE usage_log ADD COLUMN source TEXT NOT NULL DEFAULT 'chat'`);
    } catch {
      // Column already exists — expected on new installs or repeated boots.
    }
    try {
      db.exec(`ALTER TABLE usage_log ADD COLUMN cost_mode TEXT DEFAULT 'balanced'`);
    } catch { /* Column already exists */ }
    try {
      db.exec(`ALTER TABLE usage_log ADD COLUMN escalated INTEGER DEFAULT 0`);
    } catch { /* Column already exists */ }
    try {
      db.exec(`ALTER TABLE usage_log ADD COLUMN original_model TEXT`);
    } catch { /* Column already exists */ }
  }

  record(params: RecordUsageParams): UsageRecord {
    const id = ulid();
    const now = new Date().toISOString();
    const costUsd = estimateCost(params.model, params.inputTokens, params.outputTokens);
    const source = params.source ?? "chat";

    this.db.prepare(`
      INSERT INTO usage_log (id, entity_id, project_path, provider, model, input_tokens, output_tokens, cost_usd, coa_fingerprint, tool_count, loop_count, created_at, source, cost_mode, escalated, original_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, params.entityId, params.projectPath ?? null,
      params.provider, params.model,
      params.inputTokens, params.outputTokens, costUsd,
      params.coaFingerprint ?? null,
      params.toolCount ?? 0, params.loopCount ?? 0, now, source,
      params.costMode ?? "balanced", params.escalated ? 1 : 0, params.originalModel ?? null,
    );

    return {
      id, entityId: params.entityId, projectPath: params.projectPath ?? null,
      provider: params.provider, model: params.model,
      inputTokens: params.inputTokens, outputTokens: params.outputTokens,
      costUsd, coaFingerprint: params.coaFingerprint ?? null,
      toolCount: params.toolCount ?? 0, loopCount: params.loopCount ?? 0,
      createdAt: now, source,
    };
  }

  getSummary(days = 30): UsageSummary {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(input_tokens), 0) as input, COALESCE(SUM(output_tokens), 0) as output,
             COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as count
      FROM usage_log WHERE created_at >= ?
    `).get(cutoff) as { input: number; output: number; cost: number; count: number };
    return {
      totalInputTokens: row.input,
      totalOutputTokens: row.output,
      totalCostUsd: Math.round(row.cost * 10000) / 10000,
      invocationCount: row.count,
    };
  }

  getByProject(days = 30): ProjectCost[] {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT project_path, SUM(input_tokens) as input, SUM(output_tokens) as output,
             SUM(cost_usd) as cost, COUNT(*) as count
      FROM usage_log WHERE created_at >= ? AND project_path IS NOT NULL
      GROUP BY project_path ORDER BY cost DESC
    `).all(cutoff) as { project_path: string; input: number; output: number; cost: number; count: number }[];
    return rows.map((r) => ({
      projectPath: r.project_path,
      inputTokens: r.input,
      outputTokens: r.output,
      costUsd: Math.round(r.cost * 10000) / 10000,
      invocationCount: r.count,
    }));
  }

  /** Per-project + per-source breakdown for the dual-bar chart (chat vs worker). */
  getByProjectAndSource(days = 30): ProjectSourceCost[] {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT project_path, source, SUM(input_tokens) as input, SUM(output_tokens) as output,
             SUM(cost_usd) as cost, COUNT(*) as count
      FROM usage_log WHERE created_at >= ? AND project_path IS NOT NULL
      GROUP BY project_path, source ORDER BY cost DESC
    `).all(cutoff) as { project_path: string; source: string; input: number; output: number; cost: number; count: number }[];
    return rows.map((r) => ({
      projectPath: r.project_path,
      source: (r.source === "worker" ? "worker" : "chat") as "chat" | "worker",
      inputTokens: r.input,
      outputTokens: r.output,
      costUsd: Math.round(r.cost * 10000) / 10000,
      invocationCount: r.count,
    }));
  }

  getHistory(days = 30, bucket: "hour" | "day" = "day"): Array<{ period: string; inputTokens: number; outputTokens: number; costUsd: number; count: number }> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const bucketExpr = bucket === "hour"
      ? "strftime('%Y-%m-%dT%H:00:00Z', created_at)"
      : "strftime('%Y-%m-%dT00:00:00Z', created_at)";
    const rows = this.db.prepare(`
      SELECT ${bucketExpr} as period, SUM(input_tokens) as input, SUM(output_tokens) as output,
             SUM(cost_usd) as cost, COUNT(*) as count
      FROM usage_log WHERE created_at >= ?
      GROUP BY period ORDER BY period
    `).all(cutoff) as { period: string; input: number; output: number; cost: number; count: number }[];
    return rows.map((r) => ({
      period: r.period,
      inputTokens: r.input,
      outputTokens: r.output,
      costUsd: Math.round(r.cost * 10000) / 10000,
      count: r.count,
    }));
  }

  getByProvider(days = 30): Array<{ provider: string; inputTokens: number; outputTokens: number; costUsd: number; invocationCount: number }> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT provider, SUM(input_tokens) as input, SUM(output_tokens) as output,
             SUM(cost_usd) as cost, COUNT(*) as count
      FROM usage_log WHERE created_at >= ?
      GROUP BY provider ORDER BY cost DESC
    `).all(cutoff) as { provider: string; input: number; output: number; cost: number; count: number }[];
    return rows.map((r) => ({
      provider: r.provider,
      inputTokens: r.input,
      outputTokens: r.output,
      costUsd: Math.round(r.cost * 10000) / 10000,
      invocationCount: r.count,
    }));
  }

  getByModel(days = 30): Array<{ model: string; provider: string; inputTokens: number; outputTokens: number; costUsd: number; invocationCount: number }> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT model, provider, SUM(input_tokens) as input, SUM(output_tokens) as output,
             SUM(cost_usd) as cost, COUNT(*) as count
      FROM usage_log WHERE created_at >= ?
      GROUP BY model, provider ORDER BY cost DESC
    `).all(cutoff) as { model: string; provider: string; input: number; output: number; cost: number; count: number }[];
    return rows.map((r) => ({
      model: r.model,
      provider: r.provider,
      inputTokens: r.input,
      outputTokens: r.output,
      costUsd: Math.round(r.cost * 10000) / 10000,
      invocationCount: r.count,
    }));
  }

  getByCostMode(days = 30): Array<{ costMode: string; inputTokens: number; outputTokens: number; costUsd: number; invocationCount: number }> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT cost_mode, SUM(input_tokens) as input, SUM(output_tokens) as output,
             SUM(cost_usd) as cost, COUNT(*) as count
      FROM usage_log WHERE created_at >= ?
      GROUP BY cost_mode ORDER BY cost DESC
    `).all(cutoff) as { cost_mode: string; input: number; output: number; cost: number; count: number }[];
    return rows.map((r) => ({
      costMode: r.cost_mode ?? "balanced",
      inputTokens: r.input,
      outputTokens: r.output,
      costUsd: Math.round(r.cost * 10000) / 10000,
      invocationCount: r.count,
    }));
  }

  getEscalationRate(days = 30): { total: number; escalated: number; rate: number } {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN escalated = 1 THEN 1 ELSE 0 END) as escalated
      FROM usage_log WHERE created_at >= ?
    `).get(cutoff) as { total: number; escalated: number };
    return {
      total: row.total,
      escalated: row.escalated ?? 0,
      rate: row.total > 0 ? (row.escalated ?? 0) / row.total : 0,
    };
  }
}
