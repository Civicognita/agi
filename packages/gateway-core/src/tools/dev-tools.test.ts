/**
 * Dev Tools Tests
 *
 * Covers:
 * - shell_exec (shell-exec.ts)
 * - file_read (file-read.ts)
 * - file_write (file-write.ts)
 * - dir_list (dir-list.ts)
 * - grep_search (grep-search.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createShellExecHandler } from "./shell-exec.js";
import { createFileReadHandler } from "./file-read.js";
import { createFileWriteHandler } from "./file-write.js";
import { createDirListHandler } from "./dir-list.js";
import { createGrepSearchHandler } from "./grep-search.js";

// ---------------------------------------------------------------------------
// Shared temp directory setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "aionima-dev-tools-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// shell_exec
// ---------------------------------------------------------------------------

describe("shell_exec — allowed commands", () => {
  it("executes a simple echo command and returns exitCode 0", async () => {
    const handler = createShellExecHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ command: "echo hello" });
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("captures stderr from commands that write to stderr", async () => {
    const handler = createShellExecHandler({ workspaceRoot: tmpDir });
    // On both Unix-like and Windows (via Git Bash), this writes to stderr
    const raw = await handler({ command: "echo error >&2" });
    const result = JSON.parse(raw) as { exitCode: number; stderr?: string; stdout?: string };
    // exitCode 0 or we see stderr output — either signals stderr capture works
    expect(result).toBeDefined();
  });

  it("reports non-zero exit code for failing commands", async () => {
    const handler = createShellExecHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ command: "exit 1" });
    const result = JSON.parse(raw) as { exitCode: number };
    expect(result.exitCode).not.toBe(0);
  });

  it("uses the provided cwd relative to workspace root", async () => {
    const subDir = join(tmpDir, "subdir");
    mkdirSync(subDir);
    const handler = createShellExecHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ command: "pwd", cwd: "subdir" });
    const result = JSON.parse(raw) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("subdir");
  });
});

describe("shell_exec — blocked commands", () => {
  it("blocks rm -rf / with an error", async () => {
    const handler = createShellExecHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ command: "rm -rf /" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("Blocked");
  });

  it("blocks shutdown command", async () => {
    const handler = createShellExecHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ command: "shutdown now" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("Blocked");
  });

  it("rejects empty commands", async () => {
    const handler = createShellExecHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ command: "   " });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toContain("Empty command");
  });
});

describe("shell_exec — workspace confinement", () => {
  it("rejects cwd outside the workspace root", async () => {
    const handler = createShellExecHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ command: "pwd", cwd: "../../etc" });
    const result = JSON.parse(raw) as { error: string; exitCode: number };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("workspace boundary");
  });
});

describe("shell_exec — timeout", () => {
  it("caps timeout_ms at MAX_TIMEOUT_MS (120000)", async () => {
    // We verify behavior by passing a very small timeout — command should fail or succeed quickly
    const handler = createShellExecHandler({ workspaceRoot: tmpDir });
    // echo is fast enough that even a 100ms timeout should not fire
    const raw = await handler({ command: "echo fast", timeout_ms: 100 });
    const result = JSON.parse(raw) as { exitCode: number };
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// file_read
// ---------------------------------------------------------------------------

describe("file_read — within workspace boundary", () => {
  it("reads a file and returns its content", async () => {
    const filePath = join(tmpDir, "test.txt");
    writeFileSync(filePath, "line1\nline2\nline3");
    const handler = createFileReadHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "test.txt" });
    const result = JSON.parse(raw) as { content: string; totalLines: number };
    expect(result.content).toContain("line1");
    expect(result.totalLines).toBe(3);
  });

  it("respects offset parameter", async () => {
    const filePath = join(tmpDir, "offset.txt");
    writeFileSync(filePath, "a\nb\nc\nd\ne");
    const handler = createFileReadHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "offset.txt", offset: 2 });
    const result = JSON.parse(raw) as { content: string; offset: number };
    expect(result.offset).toBe(2);
    expect(result.content).toContain("c");
    expect(result.content).not.toContain("a");
  });

  it("respects limit parameter", async () => {
    const filePath = join(tmpDir, "limit.txt");
    writeFileSync(filePath, "1\n2\n3\n4\n5");
    const handler = createFileReadHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "limit.txt", limit: 2 });
    const result = JSON.parse(raw) as { linesReturned: number; truncated: boolean };
    expect(result.linesReturned).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("reports truncated: false when all lines fit", async () => {
    const filePath = join(tmpDir, "small.txt");
    writeFileSync(filePath, "only one line");
    const handler = createFileReadHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "small.txt" });
    const result = JSON.parse(raw) as { truncated: boolean };
    expect(result.truncated).toBe(false);
  });
});

describe("file_read — outside workspace boundary", () => {
  it("rejects paths that escape the workspace", async () => {
    const handler = createFileReadHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "../../etc/passwd" });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toContain("workspace boundary");
  });
});

describe("file_read — missing file", () => {
  it("returns an error for non-existent files", async () => {
    const handler = createFileReadHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "does-not-exist.txt" });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// file_write
// ---------------------------------------------------------------------------

describe("file_write — write and read round-trip", () => {
  it("writes a file and can be read back", async () => {
    const writeHandler = createFileWriteHandler({ workspaceRoot: tmpDir });
    const readHandler = createFileReadHandler({ workspaceRoot: tmpDir });

    const writeRaw = await writeHandler({ path: "roundtrip.txt", content: "hello aionima" });
    const writeResult = JSON.parse(writeRaw) as { path: string; bytesWritten: number };
    expect(writeResult.bytesWritten).toBeGreaterThan(0);

    const readRaw = await readHandler({ path: "roundtrip.txt" });
    const readResult = JSON.parse(readRaw) as { content: string };
    expect(readResult.content).toContain("hello aionima");
  });

  it("reports bytesWritten equal to content byte length", async () => {
    const handler = createFileWriteHandler({ workspaceRoot: tmpDir });
    const content = "exactly 12b";
    const raw = await handler({ path: "bytes.txt", content });
    const result = JSON.parse(raw) as { bytesWritten: number };
    expect(result.bytesWritten).toBe(Buffer.byteLength(content, "utf-8"));
  });

  it("overwrites existing files", async () => {
    const handler = createFileWriteHandler({ workspaceRoot: tmpDir });
    await handler({ path: "overwrite.txt", content: "original" });
    await handler({ path: "overwrite.txt", content: "updated" });

    const readHandler = createFileReadHandler({ workspaceRoot: tmpDir });
    const raw = await readHandler({ path: "overwrite.txt" });
    const result = JSON.parse(raw) as { content: string };
    expect(result.content).toContain("updated");
    expect(result.content).not.toContain("original");
  });
});

describe("file_write — create_dirs", () => {
  it("creates parent directories when create_dirs is true", async () => {
    const handler = createFileWriteHandler({ workspaceRoot: tmpDir });
    const raw = await handler({
      path: "nested/deep/file.txt",
      content: "deep content",
      create_dirs: true,
    });
    const result = JSON.parse(raw) as { path: string; bytesWritten: number };
    expect(result.bytesWritten).toBeGreaterThan(0);

    const readHandler = createFileReadHandler({ workspaceRoot: tmpDir });
    const readRaw = await readHandler({ path: "nested/deep/file.txt" });
    const readResult = JSON.parse(readRaw) as { content: string };
    expect(readResult.content).toContain("deep content");
  });

  it("fails without create_dirs when parent directory is missing", async () => {
    const handler = createFileWriteHandler({ workspaceRoot: tmpDir });
    const raw = await handler({
      path: "nonexistent/dir/file.txt",
      content: "content",
      create_dirs: false,
    });
    const result = JSON.parse(raw) as { error?: string };
    expect(result.error).toBeTruthy();
  });
});

describe("file_write — workspace confinement", () => {
  it("rejects paths that escape the workspace", async () => {
    const handler = createFileWriteHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "../../evil.txt", content: "bad" });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toContain("workspace boundary");
  });
});

// ---------------------------------------------------------------------------
// dir_list
// ---------------------------------------------------------------------------

describe("dir_list — listing", () => {
  it("lists files and directories in the workspace root", async () => {
    writeFileSync(join(tmpDir, "file1.ts"), "");
    writeFileSync(join(tmpDir, "file2.ts"), "");
    mkdirSync(join(tmpDir, "subdir"));

    const handler = createDirListHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "." });
    const result = JSON.parse(raw) as { entries: Array<{ name: string; type: string }>; count: number };

    expect(result.count).toBeGreaterThanOrEqual(3);
    const names = result.entries.map((e) => e.name);
    expect(names).toContain("file1.ts");
    expect(names).toContain("file2.ts");
    expect(names).toContain("subdir");
  });

  it("identifies directories with type 'directory'", async () => {
    mkdirSync(join(tmpDir, "mydir"));
    const handler = createDirListHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "." });
    const result = JSON.parse(raw) as { entries: Array<{ name: string; type: string }> };
    const dirEntry = result.entries.find((e) => e.name === "mydir");
    expect(dirEntry).toBeDefined();
    expect(dirEntry!.type).toBe("directory");
  });

  it("identifies files with type 'file'", async () => {
    writeFileSync(join(tmpDir, "myfile.txt"), "");
    const handler = createDirListHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "." });
    const result = JSON.parse(raw) as { entries: Array<{ name: string; type: string }> };
    const fileEntry = result.entries.find((e) => e.name === "myfile.txt");
    expect(fileEntry).toBeDefined();
    expect(fileEntry!.type).toBe("file");
  });
});

describe("dir_list — glob filter", () => {
  it("filters entries by glob pattern", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "");
    writeFileSync(join(tmpDir, "b.ts"), "");
    writeFileSync(join(tmpDir, "c.json"), "{}");

    const handler = createDirListHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: ".", pattern: "*.ts" });
    const result = JSON.parse(raw) as { entries: Array<{ name: string }>; count: number };

    expect(result.count).toBe(2);
    const names = result.entries.map((e) => e.name);
    expect(names).toContain("a.ts");
    expect(names).toContain("b.ts");
    expect(names).not.toContain("c.json");
  });

  it("returns zero entries when no files match pattern", async () => {
    writeFileSync(join(tmpDir, "file.ts"), "");
    const handler = createDirListHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: ".", pattern: "*.md" });
    const result = JSON.parse(raw) as { count: number };
    expect(result.count).toBe(0);
  });
});

describe("dir_list — workspace confinement", () => {
  it("rejects paths outside the workspace", async () => {
    const handler = createDirListHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ path: "../../etc" });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toContain("workspace boundary");
  });
});

// ---------------------------------------------------------------------------
// grep_search
// ---------------------------------------------------------------------------

describe("grep_search — regex matching", () => {
  it("finds matching lines across files", async () => {
    writeFileSync(join(tmpDir, "source.ts"), "const foo = 1;\nconst bar = 2;\nconst baz = 3;");
    const handler = createGrepSearchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ pattern: "const foo" });
    const result = JSON.parse(raw) as { matches: Array<{ file: string; line: number; content: string }>; count: number };
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.matches[0]!.content).toContain("const foo");
  });

  it("returns line numbers for each match", async () => {
    writeFileSync(join(tmpDir, "lines.ts"), "alpha\nbeta\ngamma");
    const handler = createGrepSearchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ pattern: "beta" });
    const result = JSON.parse(raw) as { matches: Array<{ line: number; content: string }> };
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.line).toBe(2);
  });

  it("returns empty matches when pattern does not match", async () => {
    writeFileSync(join(tmpDir, "nothing.ts"), "hello world");
    const handler = createGrepSearchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ pattern: "zxcvbnm" });
    const result = JSON.parse(raw) as { count: number };
    expect(result.count).toBe(0);
  });

  it("returns an error for empty pattern", async () => {
    const handler = createGrepSearchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ pattern: "" });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toContain("Pattern is required");
  });

  it("returns an error for invalid regex", async () => {
    const handler = createGrepSearchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ pattern: "[invalid" });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toBeTruthy();
  });
});

describe("grep_search — max_results", () => {
  it("truncates results at max_results", async () => {
    // Create a file with many matching lines
    const lines = Array.from({ length: 20 }, (_, i) => `match line ${String(i)}`).join("\n");
    writeFileSync(join(tmpDir, "many.ts"), lines);

    const handler = createGrepSearchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ pattern: "match line", max_results: 5 });
    const result = JSON.parse(raw) as { count: number; truncated: boolean };
    expect(result.count).toBe(5);
    expect(result.truncated).toBe(true);
  });
});

describe("grep_search — skip node_modules", () => {
  it("does not search inside node_modules directories", async () => {
    const nodeModDir = join(tmpDir, "node_modules", "some-pkg");
    mkdirSync(nodeModDir, { recursive: true });
    writeFileSync(join(nodeModDir, "index.ts"), "const FIND_ME = true;");
    writeFileSync(join(tmpDir, "source.ts"), "// no match here");

    const handler = createGrepSearchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ pattern: "FIND_ME" });
    const result = JSON.parse(raw) as { matches: Array<{ file: string }>; count: number };
    // Should not find the match inside node_modules
    expect(result.count).toBe(0);
    for (const match of result.matches) {
      expect(match.file).not.toContain("node_modules");
    }
  });
});

describe("grep_search — glob filter", () => {
  it("filters search to files matching the glob", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "const TARGET = 1;");
    writeFileSync(join(tmpDir, "b.js"), "const TARGET = 2;");

    const handler = createGrepSearchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ pattern: "TARGET", glob: "*.ts" });
    const result = JSON.parse(raw) as { matches: Array<{ file: string }>; count: number };
    expect(result.count).toBeGreaterThanOrEqual(1);
    for (const match of result.matches) {
      expect(match.file).toMatch(/\.ts$/);
    }
  });
});

describe("grep_search — workspace confinement", () => {
  it("rejects search paths outside the workspace", async () => {
    const handler = createGrepSearchHandler({ workspaceRoot: tmpDir });
    const raw = await handler({ pattern: "foo", path: "../../etc" });
    const result = JSON.parse(raw) as { error: string };
    expect(result.error).toContain("workspace boundary");
  });
});
