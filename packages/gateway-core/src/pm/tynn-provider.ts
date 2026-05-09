/**
 * TynnPmProvider — concrete PmProvider implementation that reaches the
 * tynn MCP server via @agi/mcp-client (s118 t432, cycle 34 skeleton).
 *
 * Cycle 34 (this file) ships the skeleton: constructor + method stubs that
 * throw `cycle 35` errors. Cycle 35 fills in each method by mapping
 * PmProvider operations to mcpClient.callTool("tynn", "<op>", args) and
 * translating tynn's response shape into PmTask / PmStory / PmVersion
 * objects.
 *
 * Why this lives in gateway-core, not aion-sdk:
 *   - aion-sdk owns the PmProvider interface (plugins import the type)
 *   - gateway-core owns the live McpClient instance + has @agi/mcp-client dep
 *   - TynnPmProvider needs both, so it lives next to the McpClient consumer
 *
 * The agent-tool registration (`pm` tool dispatching to the active
 * PmProvider) ships in cycle 36. Provider resolution (tynn / plugin /
 * tynn-lite) ships alongside that.
 */

import type {
  PmProvider,
  PmProject,
  PmVersion,
  PmStory,
  PmStoryStatus,
  PmTask,
  PmComment,
  PmStatus,
  PmCreateTaskInput,
  PmIWishInput,
} from "@agi/sdk";
import type { McpClient } from "@agi/mcp-client";

// ---------------------------------------------------------------------------
// Tynn wire-shape translators — tynn's vocabulary decoupled from PmProvider's
// ---------------------------------------------------------------------------

/** Tynn task status strings ↔ PmStatus.
 *  Tynn uses `qa` + `done`; PmProvider uses `testing` + `finished`. The
 *  vocabulary-decoupled design from cycle 34 means this helper absorbs the
 *  translation; callers stay clean. */
function tynnTaskStatusToPm(status: string): PmStatus {
  switch (status) {
    case "backlog": return "backlog";
    case "starting": return "starting";
    case "doing": return "doing";
    case "qa": return "testing";
    case "done": return "finished";
    case "blocked": return "blocked";
    case "archived": return "archived";
    default: return "backlog"; // defensive: unknown tynn statuses fall back to backlog
  }
}

/** Tynn story status ↔ PmStoryStatus. Stories share most statuses but use
 *  `in_progress` for the multi-task active state. */
function tynnStoryStatusToPm(status: string): PmStoryStatus {
  switch (status) {
    case "backlog": return "backlog";
    case "in_progress": return "in_progress";
    case "qa": return "qa";
    case "done": return "done";
    case "blocked": return "blocked";
    case "archived": return "archived";
    default: return "backlog";
  }
}

/** Translate a tynn task entity from MCP wire shape to PmTask. */
function toPmTask(raw: Record<string, unknown>): PmTask {
  return {
    id: String(raw["id"] ?? ""),
    number: Number(raw["task_number"] ?? raw["number"] ?? 0),
    storyId: String(raw["story_id"] ?? ""),
    title: String(raw["title"] ?? ""),
    status: tynnTaskStatusToPm(String(raw["status"] ?? "backlog")),
    description: typeof raw["description"] === "string" ? raw["description"] : undefined,
    priority: raw["priority"] === "active" || raw["priority"] === "qa" || raw["priority"] === "blocked"
      ? raw["priority"]
      : undefined,
    verificationSteps: Array.isArray(raw["verification_steps"]) ? raw["verification_steps"] as string[] : undefined,
    codeArea: typeof raw["code_area"] === "string" ? raw["code_area"] : undefined,
  };
}

/** Translate a tynn story entity from MCP wire shape to PmStory. */
function toPmStory(raw: Record<string, unknown>): PmStory {
  return {
    id: String(raw["id"] ?? ""),
    number: Number(raw["story_number"] ?? raw["number"] ?? 0),
    versionId: String(raw["version_id"] ?? ""),
    title: String(raw["title"] ?? ""),
    status: tynnStoryStatusToPm(String(raw["status"] ?? "backlog")),
    description: typeof raw["description"] === "string" ? raw["description"] : undefined,
    taskStatusSnapshot: typeof raw["task_status_snapshot"] === "object" && raw["task_status_snapshot"] !== null
      ? raw["task_status_snapshot"] as PmStory["taskStatusSnapshot"]
      : undefined,
  };
}

/** Translate a tynn version entity to PmVersion. */
function toPmVersion(raw: Record<string, unknown>): PmVersion {
  const status = String(raw["status"] ?? "scheduled");
  return {
    id: String(raw["id"] ?? ""),
    number: String(raw["number"] ?? ""),
    title: String(raw["title"] ?? ""),
    status: status === "active" || status === "completed" || status === "released"
      ? status as PmVersion["status"]
      : "scheduled",
    description: typeof raw["why"] === "string" ? raw["why"] : undefined,
  };
}

/** Identifier used by McpClient to route calls to the registered tynn server.
 *  By convention every project that uses tynn registers its server with
 *  this id; the server-config file's `id` field must match. Future cycle 35
 *  could make this configurable per-project if multi-tynn-instance is needed. */
const DEFAULT_TYNN_SERVER_ID = "tynn";

export interface TynnPmProviderConfig {
  /** McpClient instance with the tynn server already registered + connected. */
  mcpClient: McpClient;
  /** Override the default tynn server id ("tynn"). Used when a project
   *  registers tynn under a non-default id. */
  serverId?: string;
}

export class TynnPmProvider implements PmProvider {
  readonly providerId = "tynn";

  private readonly mcp: McpClient;
  private readonly tynnServerId: string;

  constructor(config: TynnPmProviderConfig) {
    this.mcp = config.mcpClient;
    this.tynnServerId = config.serverId ?? DEFAULT_TYNN_SERVER_ID;
  }

  // -------------------------------------------------------------------------
  // Private call dispatcher
  // -------------------------------------------------------------------------

  /** Call a tynn MCP tool, parse the JSON content, throw on errors.
   *  Tynn returns JSON-stringified results in `content[0].text`. */
  private async tynnCall(op: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const result = await this.mcp.callTool(this.tynnServerId, op, args);
    // Defensive: `result.content` may be undefined when the MCP server
    // returns a malformed envelope (no content key) — without optional
    // chaining, `result.content[0]` throws "Cannot read properties of
    // undefined (reading '0')" which cascades up through the agent loop
    // and surfaces in the project chat as an opaque tool failure
    // (cycle 156 morning bug report). Optional-chain so the
    // `firstContent === undefined` check below catches it cleanly.
    const firstContent = result.content?.[0];
    const text = firstContent !== undefined && typeof firstContent["text"] === "string"
      ? firstContent["text"]
      : "";
    if (result.isError) {
      throw new Error(`tynn.${op} failed: ${text || "unknown error"}`);
    }
    if (text.length === 0) {
      throw new Error(`tynn.${op} returned no text content`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`tynn.${op} returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return (parsed ?? {}) as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // Read operations (cycle 35a)
  // -------------------------------------------------------------------------

  async getProject(): Promise<PmProject> {
    const raw = await this.tynnCall("project");
    return {
      id: String(raw["id"] ?? ""),
      name: String(raw["name"] ?? ""),
      description: typeof raw["description"] === "string"
        ? raw["description"]
        : typeof raw["ai_guidance"] === "string"
          ? raw["ai_guidance"]
          : undefined,
    };
  }

  async getNext(): Promise<{
    version: PmVersion | null;
    topStory: PmStory | null;
    tasks: PmTask[];
  }> {
    const raw = await this.tynnCall("next");
    const versionRaw = raw["active_version"];
    const storyRaw = raw["top_story"];
    const tasksRaw = raw["tasks"];
    return {
      version: versionRaw !== null && typeof versionRaw === "object"
        ? toPmVersion(versionRaw as Record<string, unknown>)
        : null,
      topStory: storyRaw !== null && typeof storyRaw === "object"
        ? toPmStory(storyRaw as Record<string, unknown>)
        : null,
      tasks: Array.isArray(tasksRaw)
        ? tasksRaw.map((t) => toPmTask(t as Record<string, unknown>))
        : [],
    };
  }

  async getTask(idOrNumber: string | number): Promise<PmTask | null> {
    const args: Record<string, unknown> = { a: "task" };
    if (typeof idOrNumber === "number") {
      args["number"] = idOrNumber;
    } else {
      args["id"] = idOrNumber;
    }
    try {
      const raw = await this.tynnCall("show", args);
      return toPmTask(raw);
    } catch (err) {
      // Tynn returns an error tool-call when the entity isn't found.
      // Translate "not found" to null; rethrow other errors.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("not found")) return null;
      throw err;
    }
  }

  async getStory(idOrNumber: string | number): Promise<PmStory | null> {
    const args: Record<string, unknown> = { a: "story" };
    if (typeof idOrNumber === "number") {
      args["number"] = idOrNumber;
    } else {
      args["id"] = idOrNumber;
    }
    try {
      const raw = await this.tynnCall("show", args);
      return toPmStory(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("not found")) return null;
      throw err;
    }
  }

  async findTasks(filter?: { storyId?: string; status?: PmStatus | PmStatus[]; limit?: number }): Promise<PmTask[]> {
    const where: Record<string, unknown> = {};
    if (filter?.storyId !== undefined) where["story_id"] = filter.storyId;
    // Status filter — translate PmStatus → tynn status. Tynn's `status` field
    // accepts a single string or an array; we normalize to array.
    if (filter?.status !== undefined) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      where["status"] = statuses.map((s) => {
        // Reverse the tynnTaskStatusToPm translation
        if (s === "testing") return "qa";
        if (s === "finished") return "done";
        return s;
      });
    }
    const args: Record<string, unknown> = { a: "task" };
    if (Object.keys(where).length > 0) args["where"] = where;
    if (filter?.limit !== undefined) args["limit"] = filter.limit;

    const raw = await this.tynnCall("find", args);
    const data = raw["data"];
    return Array.isArray(data) ? data.map((t) => toPmTask(t as Record<string, unknown>)) : [];
  }

  async getComments(entityType: "task" | "story" | "version", entityId: string): Promise<PmComment[]> {
    const raw = await this.tynnCall("find", {
      a: "comment",
      on: { type: entityType, id: entityId },
    });
    const data = raw["data"];
    if (!Array.isArray(data)) return [];
    return data.map((c) => {
      const r = c as Record<string, unknown>;
      return {
        id: String(r["id"] ?? ""),
        body: String(r["body"] ?? ""),
        author: typeof r["author"] === "string" ? r["author"] : undefined,
        createdAt: String(r["created_at"] ?? new Date().toISOString()),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Write operations (cycle 35b)
  // -------------------------------------------------------------------------

  /** Map a target PmStatus to the tynn op that triggers that transition.
   *  Tynn enforces its own allowed-transitions matrix; if the transition
   *  is illegal for the current state, the call fails (caller sees the
   *  tynn error message via tynnCall's isError handling). */
  private tynnOpForStatus(status: PmStatus): string {
    switch (status) {
      case "starting": return "starting";
      case "doing": return "start";       // tynn `start` claims + activates
      case "testing": return "testing";   // tynn moves task to qa
      case "finished": return "finished"; // tynn moves task to done
      case "blocked": return "block";
      case "backlog":
      case "archived":
        // No direct tynn op — fall through to update with status field.
        return "update";
      default:
        return "update";
    }
  }

  async setTaskStatus(taskId: string, status: PmStatus, note?: string): Promise<PmTask> {
    const op = this.tynnOpForStatus(status);
    const args: Record<string, unknown> = { a: "task", id: taskId };
    if (note !== undefined && note.length > 0) args["note"] = note;

    if (op === "update") {
      // backlog / archived path — use update with status field directly.
      args["with"] = { status: status === "backlog" ? "backlog" : "archived" };
    }

    const raw = await this.tynnCall(op, args);
    return toPmTask(raw);
  }

  async addComment(entityType: "task" | "story" | "version", entityId: string, body: string): Promise<PmComment> {
    const raw = await this.tynnCall("create", {
      a: "comment",
      on: { type: entityType, id: entityId },
      because: body,
    });
    return {
      id: String(raw["id"] ?? ""),
      body: String(raw["body"] ?? body),
      author: typeof raw["author"] === "string" ? raw["author"] : undefined,
      createdAt: String(raw["created_at"] ?? new Date().toISOString()),
    };
  }

  async updateTask(
    taskId: string,
    fields: Partial<Pick<PmTask, "title" | "description" | "verificationSteps" | "codeArea">>,
  ): Promise<PmTask> {
    const withFields: Record<string, unknown> = {};
    if (fields.title !== undefined) withFields["title"] = fields.title;
    if (fields.description !== undefined) withFields["description"] = fields.description;
    if (fields.verificationSteps !== undefined) withFields["verification_steps"] = fields.verificationSteps;
    if (fields.codeArea !== undefined) withFields["code_area"] = fields.codeArea;

    const raw = await this.tynnCall("update", {
      a: "task",
      id: taskId,
      with: withFields,
    });
    return toPmTask(raw);
  }

  async createTask(input: PmCreateTaskInput): Promise<PmTask> {
    const withFields: Record<string, unknown> = {};
    if (input.verificationSteps !== undefined) withFields["verification_steps"] = input.verificationSteps;
    if (input.codeArea !== undefined) withFields["code_area"] = input.codeArea;

    const args: Record<string, unknown> = {
      a: "task",
      on: { story_id: input.storyId },
      title: input.title,
      because: input.description,
    };
    if (Object.keys(withFields).length > 0) args["with"] = withFields;

    const raw = await this.tynnCall("create", args);
    return toPmTask(raw);
  }

  async iWish(input: PmIWishInput): Promise<{ id: string; title: string }> {
    // Tynn's iwish accepts each wish kind in its own slot; pass through
    // whichever fields the caller supplied.
    const args: Record<string, unknown> = { this: input.title };
    if (input.didnt !== undefined) args["didnt"] = input.didnt;
    if (input.when !== undefined) args["when"] = input.when;
    if (input.had !== undefined) args["had"] = input.had;
    if (input.needs !== undefined) args["needs"] = input.needs;
    if (input.explain !== undefined) args["explain"] = input.explain;
    if (input.priority !== undefined) args["priority"] = input.priority;

    const raw = await this.tynnCall("iwish", args);
    return {
      id: String(raw["id"] ?? ""),
      title: String(raw["title"] ?? input.title),
    };
  }

  // -------------------------------------------------------------------------
  // Progress surface (s118 t439 Race-to-DONE indicator data source)
  // -------------------------------------------------------------------------

  async getActiveFocusProgress(): Promise<{
    totalTasks: number;
    doneTasks: number;
    qaTasks: number;
    doingTasks: number;
    backlogTasks: number;
    blockedTasks: number;
    inProgressTasks: number;
    percentComplete: number;
  }> {
    // Derive progress from getNext()'s top_story.task_status_snapshot.
    // Tynn returns counts per status; we expose each as its own field so
    // the dashboard can render a two-tone bar (finished + qa striped) and
    // legacy callers still get inProgressTasks = qa + doing.
    const next = await this.getNext();
    const snapshot = next.topStory?.taskStatusSnapshot;
    if (snapshot === undefined) {
      return {
        totalTasks: 0,
        doneTasks: 0,
        qaTasks: 0,
        doingTasks: 0,
        backlogTasks: 0,
        blockedTasks: 0,
        inProgressTasks: 0,
        percentComplete: 0,
      };
    }
    const total = snapshot.backlog + snapshot.doing + snapshot.qa + snapshot.blocked + snapshot.done;
    return {
      totalTasks: total,
      doneTasks: snapshot.done,
      qaTasks: snapshot.qa,
      doingTasks: snapshot.doing,
      backlogTasks: snapshot.backlog,
      blockedTasks: snapshot.blocked,
      inProgressTasks: snapshot.doing + snapshot.qa,
      percentComplete: total > 0 ? Math.round((snapshot.done / total) * 100) : 0,
    };
  }
}
