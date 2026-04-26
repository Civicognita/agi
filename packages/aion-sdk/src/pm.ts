/**
 * PmProvider — the canonical project-management interface for Aionima agents.
 *
 * AGI's agentic operating model IS the tynn workflow (per memory
 * `feedback_tynn_workflow_is_the_agi_agentic_model`). This interface declares
 * the shape any backing service must speak to participate. Three implementations
 * are planned in s118:
 *
 *   - **TynnPmProvider** — wraps `@modelcontextprotocol/sdk` calls to the tynn
 *     MCP server. Default when a tynn key is configured.
 *   - **TynnLitePmProvider** — file-based fallback (`<project>/.tynn-lite/
 *     tasks.jsonl` + `state.json`). Same workflow, append-only file storage.
 *   - **Plugin-registered alternatives** — Linear, Jira, GitHub Projects, etc.
 *     via the `registerPmProvider()` plugin SDK hook (s118 t434).
 *
 * Storage is pluggable; the workflow shape is canonical. See
 * `agi/docs/agents/tynn-and-related-concepts.md` for what this is NOT
 * (Taskmaster phases, worker session state, plans).
 */

// ---------------------------------------------------------------------------
// Status enum — the tynn workflow's task lifecycle
// ---------------------------------------------------------------------------

/** Task lifecycle states. backlog → starting → doing → testing → finished
 *  with branches to blocked + archived. Same set tynn uses; mirrored here so
 *  agi-internal code is decoupled from the tynn service's exact strings. */
export type PmStatus =
  | "backlog"
  | "starting"
  | "doing"
  | "testing"
  | "finished"
  | "blocked"
  | "archived";

/** Story lifecycle — superset of task statuses with `in_progress` for the
 *  multi-task active state. */
export type PmStoryStatus = "backlog" | "in_progress" | "qa" | "done" | "blocked" | "archived";

// ---------------------------------------------------------------------------
// Entity shapes — wire-friendly, decoupled from any specific PM service
// ---------------------------------------------------------------------------

export interface PmProject {
  id: string;
  name: string;
  /** Free-form notes the PM service exposes (project description, AI guidance, etc.) */
  description?: string;
}

export interface PmVersion {
  id: string;
  number: string;
  title: string;
  status: "active" | "completed" | "scheduled" | "released";
  description?: string;
}

export interface PmStory {
  id: string;
  number: number;
  versionId: string;
  title: string;
  status: PmStoryStatus;
  description?: string;
  /** Snapshot of task statuses for at-a-glance progress views. */
  taskStatusSnapshot?: { backlog: number; doing: number; qa: number; blocked: number; done: number };
}

export interface PmTask {
  id: string;
  number: number;
  storyId: string;
  title: string;
  status: PmStatus;
  description?: string;
  /** Whether the task is the currently-active "top" task within its story. */
  priority?: "active" | "qa" | "blocked";
  /** Verification steps from the task description (when the PM service exposes them). */
  verificationSteps?: string[];
  /** Free-form area pointer — file paths, package names, etc. */
  codeArea?: string;
}

export interface PmComment {
  id: string;
  body: string;
  author?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Operation inputs
// ---------------------------------------------------------------------------

/** Input for creating a new task. */
export interface PmCreateTaskInput {
  storyId: string;
  title: string;
  description: string;
  verificationSteps?: string[];
  codeArea?: string;
}

/** Input for capturing a wish (loose natural-language scope that the PM
 *  service converts to a task or story when ready). */
export interface PmIWishInput {
  /** Title of the wish. */
  title: string;
  /** What did wrong (for fix wishes). */
  didnt?: string;
  /** When the error occurs (for fix wishes). */
  when?: string;
  /** What feature it should have (for enhancement wishes). */
  had?: string;
  /** What maintenance/debt it needs (for chore wishes). */
  needs?: string;
  /** What needs explaining (for docs wishes). */
  explain?: string;
  /** Priority — critical, high, normal, low. */
  priority?: "critical" | "high" | "normal" | "low";
}

// ---------------------------------------------------------------------------
// PmProvider — the interface every backing service implements
// ---------------------------------------------------------------------------

/**
 * The canonical interface for Aionima's project-management surface.
 *
 * Methods map roughly to tynn's operations but stay vocabulary-decoupled:
 * tynn uses `claim`/`start`/`testing`/`finished` as separate operations;
 * this interface uses `setTaskStatus(id, "doing")` etc. to reduce the
 * surface every implementation must provide.
 *
 * All methods are async because storage may be remote (tynn-the-service via
 * MCP) or local (tynn-lite file ops). All methods accept an optional `note`
 * that the implementation appends as a comment for audit-trail clarity.
 */
export interface PmProvider {
  /** Identify this provider — useful for status surfaces + plugin registries. */
  readonly providerId: string;

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  /** Get the configured project's metadata. */
  getProject(): Promise<PmProject>;

  /** Get the active version + its top story + in-progress tasks. The
   *  per-iteration "what should I do now?" entry point. Returns null when
   *  no version is active or the project is empty. */
  getNext(): Promise<{
    version: PmVersion | null;
    topStory: PmStory | null;
    tasks: PmTask[];
  }>;

  /** Get a single task by id or number. */
  getTask(idOrNumber: string | number): Promise<PmTask | null>;

  /** Get a single story by id or number. */
  getStory(idOrNumber: string | number): Promise<PmStory | null>;

  /** List tasks matching a filter. Empty filter returns all active tasks
   *  (excluding archived). */
  findTasks(filter?: {
    storyId?: string;
    status?: PmStatus | PmStatus[];
    limit?: number;
  }): Promise<PmTask[]>;

  /** List comments on an entity. */
  getComments(entityType: "task" | "story" | "version", entityId: string): Promise<PmComment[]>;

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  /** Transition a task's status. Implementation enforces tynn's allowed-
   *  transitions matrix (e.g. doing → finished is rejected; must go via
   *  testing first). */
  setTaskStatus(taskId: string, status: PmStatus, note?: string): Promise<PmTask>;

  /** Append a comment to any entity. */
  addComment(entityType: "task" | "story" | "version", entityId: string, body: string): Promise<PmComment>;

  /** Update a task's title/description/verificationSteps/codeArea. Returns
   *  the updated task. */
  updateTask(taskId: string, fields: Partial<Pick<PmTask, "title" | "description" | "verificationSteps" | "codeArea">>): Promise<PmTask>;

  /** Create a new task under a story. */
  createTask(input: PmCreateTaskInput): Promise<PmTask>;

  /** Capture a loose natural-language wish — fix, enhancement, chore, docs,
   *  etc. The PM service decides when to convert it to a story or task. */
  iWish(input: PmIWishInput): Promise<{ id: string; title: string }>;

  // -------------------------------------------------------------------------
  // Optional: progress + capability surfaces
  // -------------------------------------------------------------------------

  /** Race-to-DONE progress for the active focus, when the implementation
   *  can compute it. UX consumes this for the indicator badge in s118 t439.
   *  Optional because tynn-lite or a minimal plugin may not implement it. */
  getActiveFocusProgress?(): Promise<{
    totalTasks: number;
    doneTasks: number;
    inProgressTasks: number;
    blockedTasks: number;
    percentComplete: number;
  }>;
}
