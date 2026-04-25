// Unit tests for the `agi bash` passthrough subcommand (story #104, task #336).
//
// Spawns the dev source agi-cli.sh directly via child_process.spawnSync and
// asserts behavior end-to-end: exit code propagation, structured JSONL log
// shape, policy allow/deny, allow_overrides audit_note, hot-reload, and
// caller attribution. Logs are redirected to a tempdir per-test via
// AGI_LOG_DIR; policy is overridden via AGI_CONFIG_PATH. The user's real
// ~/.agi/logs/ and gateway.json are never touched.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve script path relative to this test file so the suite works in both
// host (~/temp_core/agi/) and VM (/mnt/agi/) environments. The repo layout
// puts scripts/ as a sibling of cli/, so we go up two levels from cli/src/
// to reach the repo root, then descend into scripts/.
const TEST_FILE = fileURLToPath(import.meta.url);
const SCRIPT = join(dirname(TEST_FILE), "..", "..", "scripts", "agi-cli.sh");

interface LogRecord {
  ts: string;
  caller: string;
  cwd: string;
  cmd_hash: string;
  exit_code: number;
  duration_ms: number;
  stdout_bytes: number;
  stderr_bytes: number;
  blocked: boolean;
  denial_reason: string;
  audit_note: string;
}

interface TestCtx {
  logDir: string;
  configPath: string;
  cleanup: () => Promise<void>;
}

async function makeCtx(): Promise<TestCtx> {
  const root = join(tmpdir(), `agi-bash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const logDir = join(root, "logs");
  const configPath = join(root, "gateway.json");
  await mkdir(logDir, { recursive: true });
  return {
    logDir,
    configPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function runBash(
  ctx: TestCtx,
  args: string[],
  extraEnv: Record<string, string> = {},
): SpawnSyncReturns<string> {
  return spawnSync("bash", [SCRIPT, "bash", ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      AGI_LOG_DIR: ctx.logDir,
      AGI_CONFIG_PATH: ctx.configPath,
      ...extraEnv,
    },
  });
}

async function readLogRecords(ctx: TestCtx): Promise<LogRecord[]> {
  // The script writes to agi-bash-YYYY-MM-DD.jsonl based on the current
  // local date. Read whatever .jsonl files exist in the log dir and concat.
  const files = (await import("node:fs/promises")).readdir(ctx.logDir);
  const names = (await files).filter((n) => n.startsWith("agi-bash-") && n.endsWith(".jsonl"));
  const all: LogRecord[] = [];
  for (const name of names) {
    const content = await readFile(join(ctx.logDir, name), "utf-8");
    for (const line of content.split("\n")) {
      if (line.trim()) all.push(JSON.parse(line) as LogRecord);
    }
  }
  return all;
}

async function writePolicy(
  ctx: TestCtx,
  policy: { deny_patterns?: string[]; allow_overrides?: string[] },
): Promise<void> {
  await writeFile(ctx.configPath, JSON.stringify({ bash: { policy } }), "utf-8");
}

describe("agi bash — passthrough surface", () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await makeCtx();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe("exit code propagation", () => {
    it("propagates exit 0 from a successful command", () => {
      const result = runBash(ctx, ["echo", "hello"]);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
    });

    it("propagates a non-zero exit code", () => {
      const result = runBash(ctx, ["exit 42"]);
      expect(result.status).toBe(42);
    });

    it("returns 2 when called with no arguments", () => {
      const result = runBash(ctx, []);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("missing command");
    });

    it("strips a leading -c and forwards the rest", () => {
      const result = runBash(ctx, ["-c", "pwd"]);
      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it("passes stderr from the inner command through unmuted", () => {
      const result = runBash(ctx, ["echo stdout-line && echo stderr-line >&2 && exit 7"]);
      expect(result.status).toBe(7);
      expect(result.stdout.trim()).toBe("stdout-line");
      expect(result.stderr).toContain("stderr-line");
    });
  });

  describe("logging record shape", () => {
    it("writes one JSONL record per invocation with all 11 fields populated", async () => {
      runBash(ctx, ["echo logged"]);
      const records = await readLogRecords(ctx);
      expect(records).toHaveLength(1);
      const r = records[0]!;
      expect(typeof r.ts).toBe("string");
      expect(r.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(r.caller).toBe("human");
      expect(typeof r.cwd).toBe("string");
      expect(r.cmd_hash).toMatch(/^[0-9a-f]{12}$/);
      expect(r.exit_code).toBe(0);
      expect(typeof r.duration_ms).toBe("number");
      expect(r.duration_ms).toBeGreaterThanOrEqual(0);
      expect(r.stdout_bytes).toBe("logged\n".length);
      expect(r.stderr_bytes).toBe(0);
      expect(r.blocked).toBe(false);
      expect(r.denial_reason).toBe("");
      expect(r.audit_note).toBe("");
    });

    it("does not log full command content, only a hash", async () => {
      const secret = "super-secret-string-1234";
      runBash(ctx, [`echo ${secret}`]);
      const records = await readLogRecords(ctx);
      expect(records).toHaveLength(1);
      const allFields = JSON.stringify(records[0]);
      expect(allFields).not.toContain(secret);
      expect(records[0]!.cmd_hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it("produces a stable cmd_hash for repeated commands", async () => {
      runBash(ctx, ["echo same"]);
      runBash(ctx, ["echo same"]);
      const records = await readLogRecords(ctx);
      expect(records).toHaveLength(2);
      expect(records[0]!.cmd_hash).toBe(records[1]!.cmd_hash);
    });

    it("captures byte counts but not the actual stdout/stderr text", async () => {
      const big = "x".repeat(500);
      runBash(ctx, [`echo ${big}`]);
      const records = await readLogRecords(ctx);
      const r = records[0]!;
      expect(r.stdout_bytes).toBe(big.length + 1); // +1 for trailing newline
      expect(JSON.stringify(r)).not.toContain(big);
    });

    it("respects AGI_CALLER for caller attribution", async () => {
      runBash(ctx, ["echo from-agent"], { AGI_CALLER: "chat-agent:abc123" });
      const records = await readLogRecords(ctx);
      expect(records[0]!.caller).toBe("chat-agent:abc123");
    });

    it("rejects malformed AGI_CALLER values (no JSON injection)", async () => {
      runBash(ctx, ["echo x"], { AGI_CALLER: 'bad","cwd":"injected' });
      const records = await readLogRecords(ctx);
      expect(records[0]!.caller).toBe("invalid");
    });
  });

  describe("policy — deny", () => {
    it("blocks default-denied production paths and exits 126", async () => {
      const result = runBash(ctx, ["echo /opt/aionima/config"]);
      expect(result.status).toBe(126);
      expect(result.stderr).toContain("blocked by policy");
      const records = await readLogRecords(ctx);
      expect(records).toHaveLength(1);
      expect(records[0]!.blocked).toBe(true);
      expect(records[0]!.exit_code).toBe(126);
      expect(records[0]!.denial_reason).toContain("/opt/aionima");
      expect(records[0]!.audit_note).toBe("");
    });

    it("blocks rm -rf / patterns", async () => {
      const result = runBash(ctx, ["echo before; rm -rf / ; echo after"]);
      expect(result.status).toBe(126);
      const records = await readLogRecords(ctx);
      expect(records[0]!.blocked).toBe(true);
    });

    it("user deny_patterns extend (do not replace) the defaults", async () => {
      await writePolicy(ctx, { deny_patterns: ["my-secret-string"] });
      // User pattern blocks
      const r1 = runBash(ctx, ["echo my-secret-string"]);
      expect(r1.status).toBe(126);
      // Default still blocks
      const r2 = runBash(ctx, ["echo /opt/aionima"]);
      expect(r2.status).toBe(126);
    });
  });

  describe("policy — allow", () => {
    it("permits ordinary commands with no policy file present", async () => {
      // ctx.configPath does not exist yet — script should treat as no user policy
      const result = runBash(ctx, ["echo ok"]);
      expect(result.status).toBe(0);
      const records = await readLogRecords(ctx);
      expect(records[0]!.blocked).toBe(false);
    });

    it("allow_overrides beats deny patterns and produces audit_note", async () => {
      await writePolicy(ctx, { allow_overrides: ["/opt/aionima/test"] });
      const result = runBash(ctx, ["echo /opt/aionima/test/file"]);
      expect(result.status).toBe(0);
      const records = await readLogRecords(ctx);
      expect(records[0]!.blocked).toBe(false);
      expect(records[0]!.audit_note).toContain("override");
      expect(records[0]!.audit_note).toContain("/opt/aionima/test");
    });
  });

  describe("policy — hot reload", () => {
    it("picks up config changes between invocations without restart", async () => {
      // Call 1: no policy yet → /opt/aionima/test still blocked by defaults
      const r1 = runBash(ctx, ["echo /opt/aionima/test"]);
      expect(r1.status).toBe(126);

      // Add an override and call again — same command, same process tree.
      await writePolicy(ctx, { allow_overrides: ["/opt/aionima/test"] });
      const r2 = runBash(ctx, ["echo /opt/aionima/test"]);
      expect(r2.status).toBe(0);

      // Remove the override — back to blocked.
      await writePolicy(ctx, { allow_overrides: [] });
      const r3 = runBash(ctx, ["echo /opt/aionima/test"]);
      expect(r3.status).toBe(126);

      const records = await readLogRecords(ctx);
      expect(records).toHaveLength(3);
      expect(records.map((r) => r.blocked)).toEqual([true, false, true]);
    });
  });

  describe("help surface", () => {
    it("agi help mentions the bash subcommand", () => {
      const result = spawnSync("bash", [SCRIPT, "help"], { encoding: "utf-8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("bash CMD");
    });
  });
});
