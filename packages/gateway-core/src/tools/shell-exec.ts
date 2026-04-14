/**
 * shell_exec tool — execute shell commands with sandbox constraints.
 *
 * Guards (in order):
 *   1. cwd must stay within workspaceRoot
 *   2. Absolute-blocklist of destructive patterns (rm -rf /, shutdown, etc.)
 *   3. Server-start guard (Phase 5): long-running servers are rejected so the
 *      agent routes them through the project's container via manage_project
 *      instead of binding to a host port.
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

// -------------------------------------------------------------------------
// Server-start pattern guard
// -------------------------------------------------------------------------
//
// Long-running servers bound to a host port must NEVER be started via
// shell_exec. Projects run inside Podman containers that the agent manages
// via the manage_project tool. A host-side dev server would:
//   - bind to a port the gateway or other services may also want
//   - outlive the shell_exec call (execSync blocks forever until timeout)
//   - bypass container resource limits and tunnel configuration
//
// Pattern list is conservative: \b anchors to word boundaries and each
// pattern is narrow enough to avoid false positives on one-shot commands
// like "npm install", "pnpm build", "python setup.py", etc.
const SERVER_START_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(npm|pnpm|yarn)\s+(run\s+)?(dev|start|serve)\b/i, label: "npm/pnpm/yarn dev-server" },
  { pattern: /\b(next|vite|nuxt|astro|remix)\s+dev\b/i, label: "JS framework dev server" },
  { pattern: /\bsvelte-kit\s+dev\b/i, label: "SvelteKit dev server" },
  { pattern: /\bnodemon\b/i, label: "nodemon" },
  { pattern: /\bpm2\s+start\b/i, label: "pm2 start" },
  { pattern: /\bpython\s+-m\s+(http\.server|SimpleHTTPServer)\b/i, label: "python http.server" },
  { pattern: /\bflask\s+run\b/i, label: "flask run" },
  { pattern: /\buvicorn\b/i, label: "uvicorn" },
  { pattern: /\bgunicorn\b/i, label: "gunicorn" },
  { pattern: /\brails\s+(server|s)\b/i, label: "rails server" },
  { pattern: /\bphp\s+-S\b/i, label: "php -S" },
  { pattern: /\bnc\s+-l\b/i, label: "netcat listener" },
];

const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ShellExecConfig {
  workspaceRoot: string;
  /** When true (default), block long-running server-start commands. Set to
   *  false to permit host-side server starts (e.g. intentional tooling). */
  blockServerStart?: boolean;
}

/** Detect whether a command matches a server-start pattern. Exported for tests. */
export function detectServerStart(command: string): { matched: false } | { matched: true; label: string } {
  for (const { pattern, label } of SERVER_START_PATTERNS) {
    if (pattern.test(command)) return { matched: true, label };
  }
  return { matched: false };
}

export function createShellExecHandler(config: ShellExecConfig): ToolHandler {
  const blockServerStart = config.blockServerStart ?? true;
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

    // Server-start guard
    if (blockServerStart) {
      const detect = detectServerStart(command);
      if (detect.matched) {
        return JSON.stringify({
          exitCode: -1,
          error:
            `shell_exec cannot start long-running servers on the host machine. ` +
            `Matched pattern: ${detect.label}. ` +
            `To run a dev server for a project, use the manage_project tool ` +
            `with action="host" to start the project in its container, or ` +
            `invoke the project's configured dev command via the container's ` +
            `dev-cmd endpoint. If you genuinely need a host-side server for ` +
            `non-project work, ask the owner to flip shellExec.blockServerStart to false.`,
        });
      }
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
  description:
    "Execute a one-shot shell command on the host machine. Returns stdout, stderr, and exit code. " +
    "Timeout: 30s default, 120s max. " +
    "NOT for long-running servers: commands like `npm run dev`, `vite`, `next dev`, `nodemon`, " +
    "`flask run`, `uvicorn`, `python -m http.server`, `php -S` are rejected — use the " +
    "manage_project tool to run a project's dev server inside its container instead. " +
    "Use shell_exec for: builds (`npm install`, `pnpm build`, `cargo build`), file inspection " +
    "(`ls`, `cat`, `grep`), version control (`git status`, `git log`), and other one-shot ops.",
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
