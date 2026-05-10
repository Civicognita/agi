/**
 * issue tool — Wish #21 Slice 3.
 *
 * Aion-facing surface for the per-project issue registry. Action
 * dispatcher (read/search/show/log/fix) over the per-project
 * `<projectPath>/k/issues/` Markdown registry from Slice 1; backed by
 * the same store + search logic Slice 2 added.
 *
 * Owner directive 2026-05-09: "Aion needs to log issues when expected
 * actions fail; searchable so it can find known issues; readable by
 * Claude Code." This handler is the Aion side; Claude Code uses the
 * `agi issue` CLI shipped earlier (functionally identical).
 *
 * The tool routes by `input.action`:
 *   - search:  free-text + tag:/status: filters → ranked hits
 *   - show:    fetch one issue by id (full body)
 *   - list:    summary index without body
 *   - log:     create or append-occurrence (symptom-hash dedup)
 *   - fix:     mark `fixed` + append optional resolution
 *
 * Project scoping: every action requires a `projectPath` input —
 * issues live per-project and the agent must be explicit about which
 * project's registry to operate on. Mirrors the `notes` tool's
 * project-scope-gating pattern.
 */

import type { ToolHandler } from "../tool-registry.js";
import {
  listIssues,
  logIssue,
  readIssue,
  searchIssues,
  updateIssueStatus,
  type IssueStatus,
  type LogIssueInput,
} from "../issues/index.js";

export interface CreateIssueHandlerConfig {
  /** Workspace project paths used to validate `projectPath` input. */
  workspaceProjects: () => string[];
  /** Optional override for resolve+normalize behavior; defaults to identity. */
  normalizePath?: (p: string) => string;
}

const VALID_ACTIONS = new Set(["search", "show", "list", "log", "fix"]);
const VALID_STATUSES: IssueStatus[] = ["open", "known", "fixed", "wont-fix"];

function err(message: string): string {
  return JSON.stringify({ error: message });
}

export function createIssueHandler(config: CreateIssueHandlerConfig): ToolHandler {
  const normalize = config.normalizePath ?? ((p: string) => p);

  function isInWorkspace(projectPath: string): boolean {
    const target = normalize(projectPath);
    return config.workspaceProjects().some((dir) => target.startsWith(normalize(dir)));
  }

  return async (input: Record<string, unknown>): Promise<string> => {
    const action = String(input.action ?? "").trim();
    if (!VALID_ACTIONS.has(action)) {
      return err(`action must be one of ${[...VALID_ACTIONS].join(", ")}`);
    }
    const projectPath = typeof input.projectPath === "string" ? input.projectPath.trim() : "";
    if (!projectPath) {
      return err("projectPath is required");
    }
    if (!isInWorkspace(projectPath)) {
      return err("projectPath is not inside a configured workspace.projects directory");
    }

    try {
      switch (action) {
        case "search": {
          const query = typeof input.query === "string" ? input.query : "";
          const hits = searchIssues(projectPath, query);
          return JSON.stringify({ action: "search", query, hits });
        }
        case "show": {
          const id = typeof input.id === "string" ? input.id.trim() : "";
          if (!id) return err("id is required for show");
          const issue = readIssue(projectPath, id);
          if (!issue) return JSON.stringify({ action: "show", id, error: "not found" });
          return JSON.stringify({ action: "show", id, issue });
        }
        case "list": {
          const issues = listIssues(projectPath);
          return JSON.stringify({ action: "list", issues });
        }
        case "log": {
          const title = typeof input.title === "string" ? input.title : "";
          const symptom = typeof input.symptom === "string" ? input.symptom : "";
          if (!title || !symptom) return err("title and symptom are required for log");
          const tool = typeof input.tool === "string" ? input.tool : undefined;
          const exitRaw = input.exit_code;
          const exit_code = typeof exitRaw === "number" ? exitRaw : undefined;
          const tagsRaw = input.tags;
          const tags = Array.isArray(tagsRaw)
            ? tagsRaw.filter((t): t is string => typeof t === "string")
            : undefined;
          const agentRaw = input.agent;
          const agent = typeof agentRaw === "string" ? agentRaw : "$A0";
          const inputBody: LogIssueInput = { title, symptom, tool, exit_code, tags, agent };
          const result = logIssue(projectPath, inputBody);
          return JSON.stringify({ action: "log", ...result });
        }
        case "fix": {
          const id = typeof input.id === "string" ? input.id.trim() : "";
          if (!id) return err("id is required for fix");
          const status = (typeof input.status === "string" && (VALID_STATUSES as string[]).includes(input.status))
            ? (input.status as IssueStatus)
            : "fixed";
          const resolution = typeof input.resolution === "string" ? input.resolution : undefined;
          const updated = updateIssueStatus(projectPath, id, status, resolution);
          if (!updated) return JSON.stringify({ action: "fix", id, error: "not found" });
          return JSON.stringify({ action: "fix", id, status: updated.status });
        }
        default:
          return err(`unknown action: ${action}`);
      }
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  };
}

export const ISSUE_TOOL_MANIFEST = {
  name: "issue",
  description:
    "Per-project issue registry — log/search/show/fix recurring failures. Symptom-hash dedup auto-increments occurrences when the same failure recurs (so the same problem doesn't get filed twice). Use 'search' BEFORE filing to check for known issues; use 'log' when an expected action fails and you want it tracked. Actions: 'search' (text + tag:/status: filters), 'show' (full body by id), 'list' (summary index), 'log' (create or append-occurrence), 'fix' (mark fixed + append resolution). Issues live at <projectPath>/k/issues/.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const ISSUE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["search", "show", "list", "log", "fix"],
      description: "Which issue operation to run.",
    },
    projectPath: {
      type: "string",
      description: "Absolute path of the project whose registry to operate on. Must be inside a workspace.projects directory.",
    },
    query: {
      type: "string",
      description: "(search) Free-text query. Tokens AND-combined; case-insensitive. Supports `tag:<name>` and `status:<s>` filters.",
    },
    id: {
      type: "string",
      description: "(show, fix) Issue id (e.g. 'i-001').",
    },
    title: {
      type: "string",
      description: "(log) Short headline for a new issue.",
    },
    symptom: {
      type: "string",
      description: "(log) Description of the failure — used for symptom-hash dedup.",
    },
    tool: {
      type: "string",
      description: "(log) Tool/command/endpoint that failed (factors into dedup hash).",
    },
    exit_code: {
      type: "number",
      description: "(log) Exit code (factors into dedup hash).",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "(log) Free-form tags for grouping (e.g. 'taskmaster', 'auth').",
    },
    agent: {
      type: "string",
      description: "(log) Who filed it. Defaults to '$A0' (Aion).",
    },
    status: {
      type: "string",
      enum: ["open", "known", "fixed", "wont-fix"],
      description: "(fix) Status to set; defaults to 'fixed'.",
    },
    resolution: {
      type: "string",
      description: "(fix) Optional resolution note appended to the issue body.",
    },
  },
  required: ["action", "projectPath"],
};
