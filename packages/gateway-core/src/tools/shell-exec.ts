/**
 * shell_exec tool — execute shell commands with sandbox constraints.
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { ToolHandler } from "../tool-registry.js";

const BLOCKED_COMMANDS: string[] = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "dd if=",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
  ":(){:|:&};:",
  "chmod -R 777 /",
  "chown -R",
];

const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ShellExecConfig {
  workspaceRoot: string;
}

export function createShellExecHandler(config: ShellExecConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const command = String(input.command ?? "");
    const timeoutMs = Math.min(
      Number(input.timeout_ms ?? DEFAULT_TIMEOUT_MS),
      MAX_TIMEOUT_MS,
    );
    const cwd = input.cwd
      ? resolve(config.workspaceRoot, String(input.cwd))
      : config.workspaceRoot;

    // Workspace boundary check for cwd
    if (!cwd.startsWith(config.workspaceRoot)) {
      return JSON.stringify({ error: "Access denied: cwd escapes workspace boundary", exitCode: -1 });
    }

    // Check blocked commands
    const cmdLower = command.toLowerCase();
    for (const blocked of BLOCKED_COMMANDS) {
      if (cmdLower.includes(blocked.toLowerCase())) {
        return JSON.stringify({ error: `Blocked command: ${blocked}`, exitCode: -1 });
      }
    }

    if (command.trim() === "") {
      return JSON.stringify({ error: "Empty command", exitCode: -1 });
    }

    try {
      const stdout = execSync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const truncated = stdout.length > 16_384;
      const output = truncated ? stdout.slice(0, 16_384) + "\n[...truncated]" : stdout;

      return JSON.stringify({ exitCode: 0, stdout: output, stderr: "", truncated });
    } catch (err: unknown) {
      const execErr = err as { status?: number; stdout?: string; stderr?: string; killed?: boolean; signal?: string };
      if (execErr.killed || execErr.signal === "SIGTERM") {
        return JSON.stringify({ error: "Command timed out", exitCode: -1, truncated: false });
      }
      return JSON.stringify({
        exitCode: execErr.status ?? 1,
        stdout: String(execErr.stdout ?? "").slice(0, 8192),
        stderr: String(execErr.stderr ?? "").slice(0, 8192),
        truncated: false,
      });
    }
  };
}

export const SHELL_EXEC_MANIFEST = {
  name: "shell_exec",
  description: "Execute a shell command on the host machine. Returns stdout, stderr, and exit code. Timeout: 30s default, 120s max. Full machine access.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const SHELL_EXEC_INPUT_SCHEMA = {
  type: "object",
  properties: {
    command: { type: "string", description: "Shell command to execute" },
    timeout_ms: { type: "number", description: "Timeout in milliseconds (max 120000)" },
    cwd: { type: "string", description: "Working directory (absolute path, defaults to /)" },
  },
  required: ["command"],
};
