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
  PmTask,
  PmComment,
  PmStatus,
  PmCreateTaskInput,
  PmIWishInput,
} from "@agi/sdk";
import type { McpClient } from "@agi/mcp-client";

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
  // Read operations — cycle 35
  // -------------------------------------------------------------------------

  async getProject(): Promise<PmProject> {
    // Cycle 35 wires this via:
    //   await this.mcp.callTool(this.tynnServerId, "project", {});
    throw new Error(`TynnPmProvider.getProject: not yet implemented (cycle 35) — would call mcp.${this.tynnServerId}.project`);
  }

  async getNext(): Promise<{
    version: PmVersion | null;
    topStory: PmStory | null;
    tasks: PmTask[];
  }> {
    // Cycle 35 wires this via:
    //   const result = await this.mcp.callTool(this.tynnServerId, "next", {});
    void this.mcp; // silence unused-private warning until cycle 35
    throw new Error("TynnPmProvider.getNext: not yet implemented (cycle 35)");
  }

  async getTask(_idOrNumber: string | number): Promise<PmTask | null> {
    throw new Error("TynnPmProvider.getTask: not yet implemented (cycle 35)");
  }

  async getStory(_idOrNumber: string | number): Promise<PmStory | null> {
    throw new Error("TynnPmProvider.getStory: not yet implemented (cycle 35)");
  }

  async findTasks(_filter?: { storyId?: string; status?: PmStatus | PmStatus[]; limit?: number }): Promise<PmTask[]> {
    throw new Error("TynnPmProvider.findTasks: not yet implemented (cycle 35)");
  }

  async getComments(_entityType: "task" | "story" | "version", _entityId: string): Promise<PmComment[]> {
    throw new Error("TynnPmProvider.getComments: not yet implemented (cycle 35)");
  }

  // -------------------------------------------------------------------------
  // Write operations — cycle 35
  // -------------------------------------------------------------------------

  async setTaskStatus(_taskId: string, _status: PmStatus, _note?: string): Promise<PmTask> {
    throw new Error("TynnPmProvider.setTaskStatus: not yet implemented (cycle 35)");
  }

  async addComment(_entityType: "task" | "story" | "version", _entityId: string, _body: string): Promise<PmComment> {
    throw new Error("TynnPmProvider.addComment: not yet implemented (cycle 35)");
  }

  async updateTask(
    _taskId: string,
    _fields: Partial<Pick<PmTask, "title" | "description" | "verificationSteps" | "codeArea">>,
  ): Promise<PmTask> {
    throw new Error("TynnPmProvider.updateTask: not yet implemented (cycle 35)");
  }

  async createTask(_input: PmCreateTaskInput): Promise<PmTask> {
    throw new Error("TynnPmProvider.createTask: not yet implemented (cycle 35)");
  }

  async iWish(_input: PmIWishInput): Promise<{ id: string; title: string }> {
    throw new Error("TynnPmProvider.iWish: not yet implemented (cycle 35)");
  }

  // -------------------------------------------------------------------------
  // Optional progress surface — cycle 35 (implementing this is what unblocks
  // the s118 t439 Race-to-DONE indicator UX)
  // -------------------------------------------------------------------------

  async getActiveFocusProgress(): Promise<{
    totalTasks: number;
    doneTasks: number;
    inProgressTasks: number;
    blockedTasks: number;
    percentComplete: number;
  }> {
    throw new Error("TynnPmProvider.getActiveFocusProgress: not yet implemented (cycle 35)");
  }
}
