/**
 * ConsolidationEngine — Layer B→semantic bridge (s112 Phase 4).
 *
 * At session/job boundaries, fetches unconsolidated episodic events and asks
 * the LLM to extract relationship triples. Writes them to the relationships
 * table with temporal validity windows and provenance chains.
 *
 * Predicate vocabulary (closed set to keep queries predictable):
 *   worked_on | decided | learned | used_tool | blocked_by |
 *   completed | discovered | prefers | created | fixed
 *
 * Trigger sites:
 *   - EpisodeExtractor.extractAndStore() — post-invocation (session boundary)
 *   - IterativeWorkScheduler.recordCompletion() — job completion
 *   - Server idle timer — every 30 min
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";
import type { GraphMemoryAdapter, GraphEventRecord, RelationshipRecord } from "./graph-adapter.js";

const _promptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../prompts",
);

function loadPrompt(name: string): string {
  try {
    return readFileSync(join(_promptsDir, name), "utf-8");
  } catch {
    return "";
  }
}

const CONSOLIDATION_PROMPT = loadPrompt("consolidation-extract.md");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsolidationEngineOptions {
  graph: GraphMemoryAdapter;
  /** LLM summarize function for extraction. */
  invoke: (prompt: string) => Promise<string>;
  logger?: { info(msg: string): void; warn(msg: string): void };
}

interface RelationshipTriple {
  predicate: string;
  objectLiteral: string;
  confidence: number;
  validUntil?: number | null;
}

// ---------------------------------------------------------------------------
// ConsolidationEngine
// ---------------------------------------------------------------------------

export class ConsolidationEngine {
  private readonly graph: GraphMemoryAdapter;
  private readonly invoke: (prompt: string) => Promise<string>;
  private readonly logger?: ConsolidationEngineOptions["logger"];

  /** Minimum unconsolidated events before consolidation runs. */
  private static readonly MIN_EVENTS = 3;

  constructor(opts: ConsolidationEngineOptions) {
    this.graph = opts.graph;
    this.invoke = opts.invoke;
    this.logger = opts.logger;
  }

  async maybeConsolidate(opts: {
    entityId: string;
    projectPath?: string | null;
    trigger: "session_close" | "job_complete" | "idle";
  }): Promise<{ eventsProcessed: number; relationshipsAdded: number }> {
    const { entityId, projectPath, trigger } = opts;
    const startedAt = Date.now();
    const logId = ulid();

    const pending = await this.graph.getUnconsolidated(
      entityId,
      projectPath,
      20,
    );

    if (pending.length < ConsolidationEngine.MIN_EVENTS) {
      return { eventsProcessed: 0, relationshipsAdded: 0 };
    }

    this.logger?.info(
      `[consolidation] ${trigger} — extracting from ${String(pending.length)} events for ${entityId}`,
    );

    let triples: RelationshipTriple[] = [];
    try {
      triples = await this.extractTriples(entityId, pending);
    } catch (err) {
      this.logger?.warn(
        `[consolidation] extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { eventsProcessed: 0, relationshipsAdded: 0 };
    }

    const now = Date.now();
    let added = 0;
    for (const triple of triples) {
      try {
        // Invalidate any prior open relationship with same subject+predicate+scope
        if (!triple.validUntil) {
          await this.graph.invalidatePriorRelationship(
            entityId,
            triple.predicate,
            projectPath ?? null,
            now,
          );
        }
        const rel: RelationshipRecord = {
          id: ulid(),
          subjectEntityId: entityId,
          predicate: triple.predicate,
          objectEntityId: null,
          objectLiteral: triple.objectLiteral,
          projectPath: projectPath ?? null,
          validFrom: now,
          validUntil: triple.validUntil ?? null,
          confidence: triple.confidence,
          sourceEventIds: pending.map((e) => e.id),
          createdAt: now,
        };
        await this.graph.storeRelationship(rel);
        added++;
      } catch {
        // Continue on individual relationship errors
      }
    }

    await this.graph.markConsolidated(pending.map((e) => e.id));
    await this.graph.storeConsolidationLog({
      id: logId,
      trigger,
      entityId,
      projectPath: projectPath ?? null,
      eventsProcessed: pending.length,
      relationshipsAdded: added,
      startedAt,
      completedAt: Date.now(),
    });

    this.logger?.info(
      `[consolidation] done — ${String(added)} relationships added from ${String(pending.length)} events`,
    );

    return { eventsProcessed: pending.length, relationshipsAdded: added };
  }

  private async extractTriples(
    entityId: string,
    events: GraphEventRecord[],
  ): Promise<RelationshipTriple[]> {
    if (!CONSOLIDATION_PROMPT) return [];

    const summaries = events
      .map((e, i) => `[${String(i + 1)}] ${e.summary}`)
      .join("\n");

    const prompt = CONSOLIDATION_PROMPT.replace(
      "{{ENTITY_ID}}",
      entityId,
    ).replace("{{SUMMARIES}}", summaries);

    const raw = await this.invoke(prompt);

    // Parse JSON array from LLM response
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown[];
      const triples: RelationshipTriple[] = [];

      for (const item of parsed) {
        const r = item as Record<string, unknown>;
        if (
          typeof r.predicate === "string" &&
          typeof r.objectLiteral === "string"
        ) {
          triples.push({
            predicate: r.predicate,
            objectLiteral: r.objectLiteral,
            confidence:
              typeof r.confidence === "number"
                ? Math.min(1, Math.max(0, r.confidence))
                : 0.8,
            validUntil:
              typeof r.validUntil === "number" ? r.validUntil : null,
          });
        }
      }
      return triples;
    } catch {
      return [];
    }
  }
}
