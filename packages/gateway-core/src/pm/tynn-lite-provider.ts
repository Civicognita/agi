/**
 * TynnLitePmProvider — file-based fallback for projects without a tynn
 * service. Speaks the same canonical PmProvider workflow as TynnPmProvider;
 * the only difference is storage.
 *
 * Storage layout (per `agi/prompts/iterative-work.md` § Tynn-lite):
 *   <project-root>/.tynn-lite/tasks.jsonl    — append-only; one snapshot per
 *     state-transition; folding by id yields current task state.
 *   <project-root>/.tynn-lite/state.json     — atomic: write to .tmp + rename.
 *     Holds {activeFocus, nextPick, lastIterationCommit}.
 *
 * **Implemented through cycle 46:** getProject, getNext, getTask, findTasks,
 * createTask, setTaskStatus, addComment, getComments, updateTask, iWish.
 *
 * **Still stubbed (cycle 47+):** getStory (no story concept in tynn-lite
 * yet), getActiveFocusProgress (needs an "active focus" scope that today
 * is just state.activeFocus pointer).
 *
 * **Sibling files added in cycle 46:**
 *   <project-root>/.tynn-lite/comments.jsonl  — append-only, one JSON
 *     record per comment, queryable by entityId.
 *   <project-root>/.tynn-lite/wishes.jsonl    — append-only, one JSON
 *     record per wish, captured natural-language scope before conversion.
 *
 * **Why sibling files over embedding:** comments and wishes are related-but-
 * separable persistence concerns. Embedding comments in task records would
 * mean every status transition copies the full comments array; embedding
 * wishes would conflate two distinct concepts (wishes are pre-task, with
 * their own structured shape). Sibling files keep each concern's access
 * pattern clean (same principle as cycle 45's "two files for orthogonal
 * access patterns").
 *
 * State.json access is exposed via TynnLite-specific getState/setState methods
 * (not on PmProvider — they're for the scheduler/agent to track focus, not
 * generic PM concerns). The cron-completion wiring that uses them lands in
 * a follow-up cycle.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import type {
  PmProvider,
  PmStatus,
  PmTask,
  PmStory,
  PmVersion,
  PmProject,
  PmComment,
  PmCreateTaskInput,
  PmIWishInput,
} from "@agi/sdk";

// ---------------------------------------------------------------------------
// On-disk shapes
// ---------------------------------------------------------------------------

/** One line in tasks.jsonl — full snapshot of a task at a transition point. */
interface TynnLiteTaskRecord {
  id: string;
  title: string;
  description: string;
  status: PmStatus;
  parentId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  tags: string[];
  /** Optional: free-form area pointer mirroring PmTask.codeArea. */
  codeArea?: string;
  /** Optional: verification steps mirroring PmTask.verificationSteps. */
  verificationSteps?: string[];
}

/** One line in comments.jsonl — append-only, never mutated. */
interface TynnLiteCommentRecord {
  id: string;
  entityType: "task" | "story" | "version";
  entityId: string;
  body: string;
  createdAt: string;
  /** Optional author tag — free-form (e.g. "$A0", "$ITERATIVE-WORK"). */
  author?: string;
}

/** One line in wishes.jsonl — append-only natural-language scope capture
 *  before conversion to a task. Mirrors PmIWishInput plus persistence fields. */
interface TynnLiteWishRecord {
  id: string;
  title: string;
  didnt?: string;
  when?: string;
  had?: string;
  needs?: string;
  explain?: string;
  priority?: "critical" | "high" | "normal" | "low";
  createdAt: string;
}

export interface TynnLiteState {
  /** Story/version/whatever the active focus identifier is. Free-form so
   *  scheduler + agent can interpret it however the project wants. */
  activeFocus: string | null;
  /** Task id the cron-fired agent should pick up next iteration. Updated
   *  at end-of-cycle by the agent (not the scheduler). */
  nextPick: string | null;
  /** SHA of the most recent commit Aion shipped from this project. */
  lastIterationCommit: string | null;
}

const EMPTY_STATE: TynnLiteState = {
  activeFocus: null,
  nextPick: null,
  lastIterationCommit: null,
};

// ---------------------------------------------------------------------------
// TynnLitePmProvider
// ---------------------------------------------------------------------------

export interface TynnLitePmProviderOpts {
  /** Absolute path to the project root. .tynn-lite/ lives directly inside. */
  projectRoot: string;
  /** Display name for the project (returned by getProject). Defaults to
   *  the project root's basename when omitted. */
  projectName?: string;
}

export class TynnLitePmProvider implements PmProvider {
  readonly providerId = "tynn-lite";
  private readonly dir: string;
  private readonly tasksPath: string;
  private readonly commentsPath: string;
  private readonly wishesPath: string;
  private readonly statePath: string;
  private readonly statePathTmp: string;
  private readonly projectName: string;

  constructor(opts: TynnLitePmProviderOpts) {
    this.dir = join(opts.projectRoot, ".tynn-lite");
    this.tasksPath = join(this.dir, "tasks.jsonl");
    this.commentsPath = join(this.dir, "comments.jsonl");
    this.wishesPath = join(this.dir, "wishes.jsonl");
    this.statePath = join(this.dir, "state.json");
    this.statePathTmp = `${this.statePath}.tmp`;
    this.projectName = opts.projectName ?? opts.projectRoot.split("/").filter((s) => s.length > 0).pop() ?? "tynn-lite-project";
  }

  // -------------------------------------------------------------------------
  // Storage helpers (private)
  // -------------------------------------------------------------------------

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  private readJsonlLines<T>(path: string): T[] {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8");
    const out: T[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        // Skip malformed lines — append-only logs sometimes have torn writes.
      }
    }
    return out;
  }

  private appendJsonl<T>(path: string, record: T): void {
    this.ensureDir();
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
  }

  private readAllRecords(): TynnLiteTaskRecord[] {
    return this.readJsonlLines<TynnLiteTaskRecord>(this.tasksPath);
  }

  /** Fold the jsonl by id, last-write-wins. Returns the current task map. */
  private foldRecords(): Map<string, TynnLiteTaskRecord> {
    const folded = new Map<string, TynnLiteTaskRecord>();
    for (const r of this.readAllRecords()) folded.set(r.id, r);
    return folded;
  }

  private appendRecord(r: TynnLiteTaskRecord): void {
    this.appendJsonl(this.tasksPath, r);
  }

  private toPmTask(r: TynnLiteTaskRecord, taskNumber: number): PmTask {
    return {
      id: r.id,
      number: taskNumber,
      storyId: r.parentId ?? "",
      title: r.title,
      description: r.description,
      status: r.status,
      verificationSteps: r.verificationSteps,
      codeArea: r.codeArea,
    };
  }

  // -------------------------------------------------------------------------
  // State.json (TynnLite-specific surface, not on PmProvider)
  // -------------------------------------------------------------------------

  /** Read the current state.json. Returns EMPTY_STATE if the file is
   *  missing or unparseable — never throws. */
  getState(): TynnLiteState {
    if (!existsSync(this.statePath)) return { ...EMPTY_STATE };
    try {
      const raw = readFileSync(this.statePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<TynnLiteState>;
      return {
        activeFocus: parsed.activeFocus ?? null,
        nextPick: parsed.nextPick ?? null,
        lastIterationCommit: parsed.lastIterationCommit ?? null,
      };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  /** Atomic state.json update — write to .tmp + rename. Caller passes
   *  partial fields; missing keys preserve their current value. */
  setState(patch: Partial<TynnLiteState>): TynnLiteState {
    this.ensureDir();
    const current = this.getState();
    const next: TynnLiteState = { ...current, ...patch };
    writeFileSync(this.statePathTmp, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    renameSync(this.statePathTmp, this.statePath);
    return next;
  }

  // -------------------------------------------------------------------------
  // PmProvider — read operations (critical-path subset)
  // -------------------------------------------------------------------------

  async getProject(): Promise<PmProject> {
    return { id: this.dir, name: this.projectName };
  }

  async getNext(): Promise<{ version: PmVersion | null; topStory: PmStory | null; tasks: PmTask[] }> {
    const folded = [...this.foldRecords().values()];
    const tasks = folded
      .filter((r) => r.status !== "archived")
      .map((r, i) => this.toPmTask(r, i + 1));
    return { version: null, topStory: null, tasks };
  }

  async getTask(idOrNumber: string | number): Promise<PmTask | null> {
    const folded = [...this.foldRecords().values()];
    if (typeof idOrNumber === "string") {
      const r = folded.find((rec) => rec.id === idOrNumber);
      if (r === undefined) return null;
      return this.toPmTask(r, folded.indexOf(r) + 1);
    }
    const idx = idOrNumber - 1;
    const r = folded[idx];
    return r ? this.toPmTask(r, idOrNumber) : null;
  }

  async findTasks(filter?: { storyId?: string; status?: PmStatus | PmStatus[]; limit?: number }): Promise<PmTask[]> {
    const folded = [...this.foldRecords().values()];
    let filtered = folded.filter((r) => r.status !== "archived");
    if (filter?.storyId !== undefined) {
      filtered = filtered.filter((r) => r.parentId === filter.storyId);
    }
    if (filter?.status !== undefined) {
      const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
      filtered = filtered.filter((r) => allowed.includes(r.status));
    }
    const limited = filter?.limit !== undefined ? filtered.slice(0, filter.limit) : filtered;
    return limited.map((r, i) => this.toPmTask(r, i + 1));
  }

  // -------------------------------------------------------------------------
  // PmProvider — write operations (critical-path subset)
  // -------------------------------------------------------------------------

  async createTask(input: PmCreateTaskInput): Promise<PmTask> {
    const now = new Date().toISOString();
    const record: TynnLiteTaskRecord = {
      id: ulid(),
      title: input.title,
      description: input.description,
      status: "backlog",
      parentId: input.storyId.length > 0 ? input.storyId : null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      tags: [],
      codeArea: input.codeArea,
      verificationSteps: input.verificationSteps,
    };
    this.appendRecord(record);
    const folded = [...this.foldRecords().values()];
    return this.toPmTask(record, folded.findIndex((r) => r.id === record.id) + 1);
  }

  async setTaskStatus(taskId: string, status: PmStatus, _note?: string): Promise<PmTask> {
    const folded = this.foldRecords();
    const current = folded.get(taskId);
    if (current === undefined) throw new Error(`tynn-lite: unknown task ${taskId}`);
    const now = new Date().toISOString();
    const updated: TynnLiteTaskRecord = {
      ...current,
      status,
      startedAt: status === "doing" && current.startedAt === null ? now : current.startedAt,
      finishedAt: (status === "finished" || status === "archived") && current.finishedAt === null ? now : current.finishedAt,
    };
    this.appendRecord(updated);
    const refolded = [...this.foldRecords().values()];
    return this.toPmTask(updated, refolded.findIndex((r) => r.id === updated.id) + 1);
  }

  // -------------------------------------------------------------------------
  // PmProvider — comments + updateTask + iWish (cycle 46)
  // -------------------------------------------------------------------------

  async addComment(entityType: "task" | "story" | "version", entityId: string, body: string): Promise<PmComment> {
    const record: TynnLiteCommentRecord = {
      id: ulid(),
      entityType,
      entityId,
      body,
      createdAt: new Date().toISOString(),
    };
    this.appendJsonl(this.commentsPath, record);
    return { id: record.id, body: record.body, createdAt: record.createdAt, author: record.author };
  }

  async getComments(entityType: "task" | "story" | "version", entityId: string): Promise<PmComment[]> {
    const records = this.readJsonlLines<TynnLiteCommentRecord>(this.commentsPath);
    return records
      .filter((r) => r.entityType === entityType && r.entityId === entityId)
      .map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, author: r.author }));
  }

  async updateTask(taskId: string, fields: Partial<Pick<PmTask, "title" | "description" | "verificationSteps" | "codeArea">>): Promise<PmTask> {
    const folded = this.foldRecords();
    const current = folded.get(taskId);
    if (current === undefined) throw new Error(`tynn-lite: unknown task ${taskId}`);
    const updated: TynnLiteTaskRecord = {
      ...current,
      title: fields.title ?? current.title,
      description: fields.description ?? current.description,
      verificationSteps: fields.verificationSteps ?? current.verificationSteps,
      codeArea: fields.codeArea ?? current.codeArea,
    };
    this.appendRecord(updated);
    const refolded = [...this.foldRecords().values()];
    return this.toPmTask(updated, refolded.findIndex((r) => r.id === updated.id) + 1);
  }

  async iWish(input: PmIWishInput): Promise<{ id: string; title: string }> {
    const record: TynnLiteWishRecord = {
      id: ulid(),
      title: input.title,
      didnt: input.didnt,
      when: input.when,
      had: input.had,
      needs: input.needs,
      explain: input.explain,
      priority: input.priority,
      createdAt: new Date().toISOString(),
    };
    this.appendJsonl(this.wishesPath, record);
    return { id: record.id, title: record.title };
  }

  /** Read all captured wishes (TynnLite-specific surface — wishes don't yet
   *  appear on PmProvider since their conversion-to-task semantics aren't
   *  generalized). Returned most-recent-first for the eventual UX surface. */
  listWishes(): TynnLiteWishRecord[] {
    return this.readJsonlLines<TynnLiteWishRecord>(this.wishesPath).reverse();
  }

  // -------------------------------------------------------------------------
  // PmProvider — methods still stubbed (cycle 47+)
  // -------------------------------------------------------------------------

  async getStory(_idOrNumber: string | number): Promise<PmStory | null> {
    // Tynn-lite has no story concept yet — tasks group via parentId only.
    // Story support lands when the schema gains a separate stories.jsonl.
    return null;
  }
}
