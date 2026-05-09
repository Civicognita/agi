/**
 * LayeredPmProvider — read-fallback wrapper around a primary PmProvider
 * (typically TynnPmProvider talking to a remote MCP service) and a
 * file-based PM-Lite fallback (typically TynnLitePmProvider).
 *
 * Wish #17 (2026-05-08) — owner directive after `pm` tool errored out
 * with "tynn not configured" instead of falling back to the file-based
 * PM-Lite that's always available. The PM workflow has ONE entryway and
 * MANY functions; PM-Lite is the floor that's always reachable, and a
 * remote provider (tynn / linear / jira / …) layers on top when the user
 * has configured one.
 *
 * **Read semantics:** every read is attempted against `primary` first.
 * If it throws or returns a tool-side error string, the call falls
 * through to `fallback`. Either provider may legitimately return null /
 * empty arrays — those are NOT treated as failures.
 *
 * **Write semantics (this rev):** writes go to whichever provider is
 * currently primary. The fully-layered "write to both" strategy is a
 * deeper design (Wish #17 follow-up, needs conflict-resolution call) —
 * for now writes route through the primary and the fallback only sees
 * writes when the primary is unreachable, AT WHICH POINT it has full
 * single-provider semantics. This avoids accidentally fanning a write
 * to two stores that disagree on what "blocked" means without a clear
 * owner-confirmed merge strategy.
 *
 * **Boot semantics:** server.ts always constructs both providers and
 * wraps them in LayeredPmProvider regardless of `agent.pm.provider`
 * setting. The default ("tynn") is the read primary; TynnLite is the
 * fallback. If the owner explicitly picks "tynn-lite", the layered
 * wrapper degenerates: primary === fallback and the two paths are
 * equivalent.
 */

import type {
  PmProvider,
  PmStatus,
  PmTask,
  PmStory,
  PmComment,
  PmCreateTaskInput,
  PmIWishInput,
} from "@agi/sdk";

export interface LayeredPmProviderOptions {
  /** The configured primary (e.g. TynnPmProvider). All reads + writes try here first. */
  primary: PmProvider;
  /** The always-available file-based floor (typically TynnLitePmProvider). */
  fallback: PmProvider;
  /** Optional logger for fallback events. */
  logger?: { info(msg: string): void; warn(msg: string): void };
}

function looksLikeErrorPayload(value: unknown): boolean {
  // Some PmProvider implementations return JSON-stringified `{"error": "..."}`
  // as their normal "operation didn't work" surface (the tynn MCP wrapper does
  // this when the tool isn't available). Treat those as a soft failure for
  // fallback purposes.
  if (typeof value === "string" && value.includes('"error"')) return true;
  if (
    typeof value === "object"
    && value !== null
    && (value as { error?: unknown }).error !== undefined
  ) return true;
  return false;
}

export class LayeredPmProvider implements PmProvider {
  readonly providerId: string;
  private readonly primary: PmProvider;
  private readonly fallback: PmProvider;
  private readonly logger?: { info(msg: string): void; warn(msg: string): void };

  constructor(opts: LayeredPmProviderOptions) {
    this.primary = opts.primary;
    this.fallback = opts.fallback;
    this.logger = opts.logger;
    // Prefer primary's id for logging; the layering is invisible to consumers.
    this.providerId = `layered(${opts.primary.providerId}+${opts.fallback.providerId})`;
  }

  private async withFallback<T>(label: string, op: (p: PmProvider) => Promise<T>): Promise<T> {
    if (this.primary === this.fallback) return op(this.primary);
    try {
      const result = await op(this.primary);
      if (looksLikeErrorPayload(result)) {
        this.logger?.info(`pm-layer: primary returned error-shaped payload for ${label}; trying fallback`);
        return await op(this.fallback);
      }
      return result;
    } catch (err) {
      this.logger?.info(`pm-layer: primary threw for ${label} (${err instanceof Error ? err.message : String(err)}); trying fallback`);
      return await op(this.fallback);
    }
  }

  // ---- Reads (each falls through to fallback on primary failure) ----

  getProject(): ReturnType<PmProvider["getProject"]> {
    return this.withFallback("getProject", (p) => p.getProject());
  }

  getNext(): ReturnType<PmProvider["getNext"]> {
    return this.withFallback("getNext", (p) => p.getNext());
  }

  getTask(idOrNumber: string | number): Promise<PmTask | null> {
    return this.withFallback("getTask", (p) => p.getTask(idOrNumber));
  }

  getStory(idOrNumber: string | number): Promise<PmStory | null> {
    return this.withFallback("getStory", (p) => p.getStory(idOrNumber));
  }

  findTasks(filter?: { storyId?: string; status?: PmStatus | PmStatus[]; limit?: number }): Promise<PmTask[]> {
    return this.withFallback("findTasks", (p) => p.findTasks(filter));
  }

  getComments(entityType: "task" | "story" | "version", entityId: string): Promise<PmComment[]> {
    return this.withFallback("getComments", (p) => p.getComments(entityType, entityId));
  }

  // ---- Writes (route through primary; fallback only on primary failure) ----

  setTaskStatus(taskId: string, status: PmStatus, note?: string): Promise<PmTask> {
    return this.withFallback("setTaskStatus", (p) => p.setTaskStatus(taskId, status, note));
  }

  addComment(entityType: "task" | "story" | "version", entityId: string, body: string): Promise<PmComment> {
    return this.withFallback("addComment", (p) => p.addComment(entityType, entityId, body));
  }

  updateTask(
    taskId: string,
    fields: Partial<Pick<PmTask, "title" | "description" | "verificationSteps" | "codeArea">>,
  ): Promise<PmTask> {
    return this.withFallback("updateTask", (p) => p.updateTask(taskId, fields));
  }

  createTask(input: PmCreateTaskInput): Promise<PmTask> {
    return this.withFallback("createTask", (p) => p.createTask(input));
  }

  iWish(input: PmIWishInput): Promise<{ id: string; title: string }> {
    return this.withFallback("iWish", (p) => p.iWish(input));
  }

  async getActiveFocusProgress(): ReturnType<NonNullable<PmProvider["getActiveFocusProgress"]>> {
    if (this.primary === this.fallback) {
      if (this.primary.getActiveFocusProgress === undefined) {
        throw new Error(`pm provider ${this.primary.providerId} does not expose getActiveFocusProgress`);
      }
      return this.primary.getActiveFocusProgress();
    }
    if (this.primary.getActiveFocusProgress !== undefined) {
      try {
        const result = await this.primary.getActiveFocusProgress();
        if (!looksLikeErrorPayload(result)) return result;
      } catch (err) {
        this.logger?.info(
          `pm-layer: primary getActiveFocusProgress threw (${err instanceof Error ? err.message : String(err)}); trying fallback`,
        );
      }
    }
    if (this.fallback.getActiveFocusProgress === undefined) {
      throw new Error(`neither pm provider exposes getActiveFocusProgress`);
    }
    return this.fallback.getActiveFocusProgress();
  }

  /** Direct accessor for the underlying providers — exposed for the
   *  `pm` agent tool's diagnostic surface so callers can see which layer
   *  served a particular response. */
  get layers(): { primary: PmProvider; fallback: PmProvider } {
    return { primary: this.primary, fallback: this.fallback };
  }
}
