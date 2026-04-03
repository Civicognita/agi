/**
 * gh_cli tool — read-only GitHub CLI commands (pr_view, pr_list, pr_diff).
 *
 * Only read-only gh pr subcommands are permitted. No create, merge, or close.
 * Requires state ONLINE, tier verified/sealed.
 */
import { execFile } from "node:child_process";
import type { ToolHandler } from "../tool-registry.js";

export interface GhCliConfig {
  workspaceRoot: string;
}

type GhCommand = "pr_view" | "pr_list" | "pr_diff";

function execGh(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      args,
      {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        encoding: "utf-8",
      },
      (err, stdout, stderr) => {
        if (err !== null) {
          const status = (err as unknown as { status?: number }).status ?? 1;
          resolve({
            stdout: String(stdout ?? "").slice(0, 16_384),
            stderr: String(stderr ?? err.message).slice(0, 8192),
            exitCode: typeof status === "number" ? status : 1,
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

export function createGhCliHandler(config: GhCliConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const command = String(input.command ?? "") as GhCommand;
    const prNumber = input.prNumber !== undefined ? Number(input.prNumber) : undefined;
    const flags = Array.isArray(input.flags)
      ? (input.flags as unknown[]).map((f) => String(f))
      : [];

    // Validate flags — block any write-intent flags
    const BLOCKED_FLAGS = [
      "--create", "--merge", "--close", "--reopen", "--edit",
      "--ready", "--draft", "--delete", "--approve", "--request-review",
    ];
    for (const flag of flags) {
      if (BLOCKED_FLAGS.some((b) => flag.startsWith(b))) {
        return JSON.stringify({
          error: `Blocked flag: ${flag}. Only read-only operations are permitted.`,
          exitCode: -1,
        });
      }
    }

    let args: string[];

    switch (command) {
      case "pr_view": {
        args = ["pr", "view"];
        if (prNumber !== undefined && !isNaN(prNumber)) {
          args.push(String(prNumber));
        }
        args.push(...flags);
        break;
      }

      case "pr_list": {
        args = ["pr", "list", ...flags];
        break;
      }

      case "pr_diff": {
        args = ["pr", "diff"];
        if (prNumber !== undefined && !isNaN(prNumber)) {
          args.push(String(prNumber));
        }
        args.push(...flags);
        break;
      }

      default:
        return JSON.stringify({
          error: `Unknown command: ${command}. Must be one of: pr_view, pr_list, pr_diff`,
          exitCode: -1,
        });
    }

    const result = await execGh(args, config.workspaceRoot);
    return JSON.stringify({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  };
}

export const GH_CLI_MANIFEST = {
  name: "gh_cli",
  description:
    "Read-only GitHub CLI commands: pr_view, pr_list, pr_diff. " +
    "Write operations (create, merge, close) are blocked. " +
    "Optionally pass prNumber and extra flags.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const GH_CLI_INPUT_SCHEMA = {
  type: "object",
  properties: {
    command: {
      type: "string",
      enum: ["pr_view", "pr_list", "pr_diff"],
      description: "GitHub CLI command to run",
    },
    prNumber: {
      type: "number",
      description: "Pull request number (required for pr_view, pr_diff)",
    },
    flags: {
      type: "array",
      items: { type: "string" },
      description: "Extra read-only flags to pass to the gh command (e.g. [\"--json\", \"title,body\"])",
    },
  },
  required: ["command"],
};
