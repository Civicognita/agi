/**
 * Git Tools — git_status, git_diff, git_add, git_commit, git_branch
 *
 * Each tool uses child_process.execFile (not exec) to avoid shell injection.
 * Blocked: git push, force-push, reset --hard. All paths validated within workspace.
 */
import { execFile } from "node:child_process";
import { resolve, relative, normalize } from "node:path";
import type { ToolHandler } from "../tool-registry.js";

// ---------------------------------------------------------------------------
// Blocked git subcommands and flags
// ---------------------------------------------------------------------------

const BLOCKED_SUBCOMMANDS = ["push", "remote"];
const BLOCKED_FLAGS = ["--force", "-f", "--hard"];

function isBlocked(args: string[]): string | null {
  const subcommand = args[0]?.toLowerCase() ?? "";

  if (BLOCKED_SUBCOMMANDS.includes(subcommand)) {
    return `Blocked git subcommand: ${subcommand}`;
  }

  // Check for blocked flags across all arguments
  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (BLOCKED_FLAGS.includes(lower)) {
      return `Blocked git flag: ${arg}`;
    }
    // Catch combined short flags like -rf
    if (subcommand === "reset" && lower === "--hard") {
      return "Blocked: git reset --hard";
    }
  }

  // Specifically block "reset --hard" even with mixed args
  if (subcommand === "reset" && args.some((a) => a.toLowerCase() === "--hard")) {
    return "Blocked: git reset --hard";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface GitToolConfig {
  workspaceRoot: string;
}

function validatePathInWorkspace(filePath: string, workspaceRoot: string): string | null {
  const resolved = resolve(workspaceRoot, filePath);
  const normalizedResolved = normalize(resolved);
  const normalizedRoot = normalize(workspaceRoot);
  const rel = relative(normalizedRoot, normalizedResolved);

  if (rel.startsWith("..") || resolve(normalizedResolved) === resolve("/")) {
    return "Path outside workspace boundary";
  }

  return null;
}

function sanitizeCommitMessage(message: string): string {
  // Remove shell-dangerous characters and control characters
  return message
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/[`$\\]/g, "")
    .slice(0, 4096); // cap at 4KB
}

function execGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        encoding: "utf-8",
      },
      (err, stdout, stderr) => {
        if (err !== null) {
          const exitCode =
            typeof (err as NodeJS.ErrnoException & { code?: number | string }).code === "number"
              ? ((err as NodeJS.ErrnoException & { code: number }).code)
              : (err as unknown as { status?: number }).status ?? 1;
          resolve({
            stdout: String(stdout ?? "").slice(0, 16_384),
            stderr: String(stderr ?? err.message).slice(0, 8192),
            exitCode: typeof exitCode === "number" ? exitCode : 1,
          });
          return;
        }
        resolve({
          stdout: String(stdout).slice(0, 16_384),
          stderr: String(stderr).slice(0, 8192),
          exitCode: 0,
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// git_status
// ---------------------------------------------------------------------------

export function createGitStatusHandler(config: GitToolConfig): ToolHandler {
  return async (_input: Record<string, unknown>): Promise<string> => {
    const result = await execGit(["status", "--porcelain", "-b"], config.workspaceRoot);
    return JSON.stringify({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  };
}

export const GIT_STATUS_MANIFEST = {
  name: "git_status",
  description:
    "Show the working tree status (porcelain format). " +
    "Returns staged, unstaged, and untracked file lists.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const GIT_STATUS_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  required: [] as string[],
};

// ---------------------------------------------------------------------------
// git_diff
// ---------------------------------------------------------------------------

export function createGitDiffHandler(config: GitToolConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const staged = input.staged === true;
    const filePath = input.path ? String(input.path) : undefined;

    const args = ["diff"];
    if (staged) {
      args.push("--cached");
    }

    if (filePath !== undefined) {
      const err = validatePathInWorkspace(filePath, config.workspaceRoot);
      if (err !== null) {
        return JSON.stringify({ error: err, exitCode: -1 });
      }
      args.push("--", filePath);
    }

    const result = await execGit(args, config.workspaceRoot);
    return JSON.stringify({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  };
}

export const GIT_DIFF_MANIFEST = {
  name: "git_diff",
  description:
    "Show differences between working tree and index, or between index and HEAD (with staged=true). " +
    "Optionally scope to a single file path.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const GIT_DIFF_INPUT_SCHEMA = {
  type: "object",
  properties: {
    staged: {
      type: "boolean",
      description: "Show staged (cached) diff instead of working tree diff",
    },
    path: {
      type: "string",
      description: "File path relative to workspace root to scope the diff",
    },
  },
  required: [] as string[],
};

// ---------------------------------------------------------------------------
// git_add
// ---------------------------------------------------------------------------

export function createGitAddHandler(config: GitToolConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const paths = input.paths;

    if (!Array.isArray(paths) || paths.length === 0) {
      return JSON.stringify({ error: "paths must be a non-empty array of file paths", exitCode: -1 });
    }

    const stringPaths: string[] = [];
    for (const p of paths) {
      const s = String(p);
      const err = validatePathInWorkspace(s, config.workspaceRoot);
      if (err !== null) {
        return JSON.stringify({ error: `${err}: ${s}`, exitCode: -1 });
      }
      stringPaths.push(s);
    }

    const args = ["add", "--", ...stringPaths];
    const blocked = isBlocked(args);
    if (blocked !== null) {
      return JSON.stringify({ error: blocked, exitCode: -1 });
    }

    const result = await execGit(args, config.workspaceRoot);
    return JSON.stringify({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      added: stringPaths,
    });
  };
}

export const GIT_ADD_MANIFEST = {
  name: "git_add",
  description:
    "Stage files for the next commit. Requires explicit file paths — no wildcards or -A.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const GIT_ADD_INPUT_SCHEMA = {
  type: "object",
  properties: {
    paths: {
      type: "array",
      items: { type: "string" },
      description: "Array of file paths relative to workspace root to stage",
    },
  },
  required: ["paths"],
};

// ---------------------------------------------------------------------------
// git_commit
// ---------------------------------------------------------------------------

export function createGitCommitHandler(config: GitToolConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const rawMessage = String(input.message ?? "");

    if (rawMessage.trim() === "") {
      return JSON.stringify({ error: "Commit message is required", exitCode: -1 });
    }

    const message = sanitizeCommitMessage(rawMessage);

    const args = ["commit", "-m", message];
    const blocked = isBlocked(args);
    if (blocked !== null) {
      return JSON.stringify({ error: blocked, exitCode: -1 });
    }

    const result = await execGit(args, config.workspaceRoot);
    return JSON.stringify({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  };
}

export const GIT_COMMIT_MANIFEST = {
  name: "git_commit",
  description:
    "Create a git commit with the staged changes. Requires a non-empty commit message.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const GIT_COMMIT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Commit message (max 4096 chars, shell-dangerous characters are stripped)",
    },
  },
  required: ["message"],
};

// ---------------------------------------------------------------------------
// git_branch
// ---------------------------------------------------------------------------

export function createGitBranchHandler(config: GitToolConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const action = String(input.action ?? "list");
    const name = input.name ? String(input.name) : undefined;

    if (action === "list") {
      const result = await execGit(["branch", "-a"], config.workspaceRoot);
      return JSON.stringify({
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }

    if (action === "create") {
      if (!name || name.trim() === "") {
        return JSON.stringify({ error: "Branch name is required for create action", exitCode: -1 });
      }
      // Validate branch name: no spaces, no shell-dangerous chars
      if (/[^a-zA-Z0-9_\-./]/.test(name)) {
        return JSON.stringify({ error: "Invalid branch name: contains disallowed characters", exitCode: -1 });
      }
      const result = await execGit(["branch", name], config.workspaceRoot);
      return JSON.stringify({
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        branch: name,
      });
    }

    if (action === "checkout") {
      if (!name || name.trim() === "") {
        return JSON.stringify({ error: "Branch name is required for checkout action", exitCode: -1 });
      }
      if (/[^a-zA-Z0-9_\-./]/.test(name)) {
        return JSON.stringify({ error: "Invalid branch name: contains disallowed characters", exitCode: -1 });
      }
      const result = await execGit(["checkout", name], config.workspaceRoot);
      return JSON.stringify({
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        branch: name,
      });
    }

    return JSON.stringify({ error: `Unknown action: ${action}. Use "list", "create", or "checkout"`, exitCode: -1 });
  };
}

export const GIT_BRANCH_MANIFEST = {
  name: "git_branch",
  description:
    "Manage git branches. Actions: list (default), create, checkout. " +
    "Push and force operations are blocked.",
  requiresState: ["ONLINE" as const, "LIMBO" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const GIT_BRANCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "create", "checkout"],
      description: 'Branch operation: "list" (default), "create", or "checkout"',
    },
    name: {
      type: "string",
      description: "Branch name (required for create and checkout)",
    },
  },
  required: [] as string[],
};
