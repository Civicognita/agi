/**
 * UsageStore — LLM token usage and cost tracking per invocation.
 *
 * Persists token counts, estimated USD cost, and project attribution
 * for every completed agent invocation. Enables True Cost per project.
 */

import { ulid } from "ulid";
import type { Database } from "./db.js";

// ---------------------------------------------------------------------------
// Pricing table (per million tokens)
// ---------------------------------------------------------------------------

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-haiku-4-5": { input: 0.80, output: 4.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.0 },
  "gpt-4o": { input: 2.50, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Match by prefix — "claude-sonnet-4-6[1m]" → "claude-sonnet-4-6"
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  if (!key) return 0;
  const p = PRICING[key]!;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

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
  }

  record(params: RecordUsageParams): UsageRecord {
    const id = ulid();
    const now = new Date().toISOString();
    const costUsd = estimateCost(params.model, params.inputTokens, params.outputTokens);

    this.db.prepare(`
      INSERT INTO usage_log (id, entity_id, project_path, provider, model, input_tokens, output_tokens, cost_usd, coa_fingerprint, tool_count, loop_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, params.entityId, params.projectPath ?? null,
      params.provider, params.model,
      params.inputTokens, params.outputTokens, costUsd,
      params.coaFingerprint ?? null,
      params.toolCount ?? 0, params.loopCount ?? 0, now,
    );

    return {
      id, entityId: params.entityId, projectPath: params.projectPath ?? null,
      provider: params.provider, model: params.model,
      inputTokens: params.inputTokens, outputTokens: params.outputTokens,
      costUsd, coaFingerprint: params.coaFingerprint ?? null,
      toolCount: params.toolCount ?? 0, loopCount: params.loopCount ?? 0,
      createdAt: now,
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
}
