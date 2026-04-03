# Agent Tools Implementation Guide

**Purpose:** Step-by-step guide to implementing the first set of autonomous developer tools.

**Timeline:** ~40 hours over 1 week

---

## Phase 1: Setup (2 hours)

### 1.1 Create Tool Directory Structure

```bash
mkdir -p packages/gateway-core/src/tools
mkdir -p packages/gateway-core/src/tools/{file,code,git,system}
```

### 1.2 Define Tool Types

Create `packages/gateway-core/src/tools/types.ts`:

```typescript
export interface ToolExecutionError {
  code: string;
  message: string;
}

export interface FileReadResult {
  path: string;
  content: string;
  lines: number;
  bytes: number;
}

export interface FileWriteResult {
  path: string;
  created: boolean;
  modified: boolean;
  bytes: number;
}

export interface FileListResult {
  path: string;
  files: string[];
  directories: string[];
}

export interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitLogResult {
  commits: Array<{
    hash: string;
    author: string;
    timestamp: string;
    message: string;
  }>;
  total: number;
}
```

---

## Phase 2: File Tools (8 hours)

### 2.1 Read File Tool

**Location:** `packages/gateway-core/src/tools/file/read.ts`

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolHandler } from "../../tool-registry.js";
import type { FileReadResult } from "../types.js";

export const readFileTool: ToolHandler = async (input) => {
  const { path, encoding = "utf-8" } = input as { path: string; encoding?: string };

  if (!path) throw new Error("path is required");

  try {
    const fullPath = resolve(process.cwd(), path);
    // Security: prevent directory traversal
    if (!fullPath.startsWith(resolve(process.cwd()))) {
      throw new Error("Access denied: path outside project");
    }

    const content = readFileSync(fullPath, encoding);
    const lines = content.split("\n").length;
    const bytes = Buffer.byteLength(content, encoding);

    const result: FileReadResult = {
      path,
      content,
      lines,
      bytes,
    };

    return JSON.stringify(result);
  } catch (err) {
    throw new Error(`Failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const READ_FILE_MANIFEST = {
  name: "read_file",
  description: "Read file content from the project. Returns up to 64 KB.",
  requiresState: ["ONLINE", "LIMBO"],
  requiresTier: ["verified", "sealed"],
  sizeCapBytes: 65536,
};

export const READ_FILE_SCHEMA = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path relative to project root (e.g., 'src/index.ts')",
    },
    encoding: {
      type: "string",
      description: "File encoding (default: utf-8)",
      enum: ["utf-8", "ascii", "base64"],
    },
  },
  required: ["path"],
};
```

### 2.2 Write File Tool

**Location:** `packages/gateway-core/src/tools/file/write.ts`

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { ToolHandler } from "../../tool-registry.js";
import type { FileWriteResult } from "../types.js";

export const writeFileTool: ToolHandler = async (input) => {
  const { path, content, append = false } = input as {
    path: string;
    content: string;
    append?: boolean;
  };

  if (!path) throw new Error("path is required");
  if (!content) throw new Error("content is required");

  try {
    const fullPath = resolve(process.cwd(), path);
    if (!fullPath.startsWith(resolve(process.cwd()))) {
      throw new Error("Access denied: path outside project");
    }

    const dir = dirname(fullPath);
    mkdirSync(dir, { recursive: true });

    let finalContent = content;
    if (append) {
      try {
        const existing = readFileSync(fullPath, "utf-8");
        finalContent = existing + "\n" + content;
      } catch {
        // File doesn't exist, create new
      }
    }

    writeFileSync(fullPath, finalContent, "utf-8");

    const result: FileWriteResult = {
      path,
      created: !existsSync(fullPath),
      modified: append,
      bytes: Buffer.byteLength(finalContent, "utf-8"),
    };

    return JSON.stringify(result);
  } catch (err) {
    throw new Error(`Failed to write ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const WRITE_FILE_MANIFEST = {
  name: "write_file",
  description: "Write or append content to a file. Sealed tier only. Returns metadata.",
  requiresState: ["ONLINE"],
  requiresTier: ["sealed"],
};

export const WRITE_FILE_SCHEMA = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "File path relative to project root",
    },
    content: {
      type: "string",
      description: "Content to write (or append if append=true)",
    },
    append: {
      type: "boolean",
      description: "If true, append to existing file instead of overwriting (default: false)",
    },
  },
  required: ["path", "content"],
};
```

### 2.3 List Files Tool

**Location:** `packages/gateway-core/src/tools/file/list.ts`

```typescript
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { glob } from "glob";
import type { ToolHandler } from "../../tool-registry.js";
import type { FileListResult } from "../types.js";

export const listFilesTool: ToolHandler = async (input) => {
  const { path = ".", pattern = "**/*", maxDepth = 3 } = input as {
    path?: string;
    pattern?: string;
    maxDepth?: number;
  };

  try {
    const fullPath = resolve(process.cwd(), path);
    if (!fullPath.startsWith(resolve(process.cwd()))) {
      throw new Error("Access denied: path outside project");
    }

    const matches = await glob(pattern, {
      cwd: fullPath,
      maxDepth,
      ignore: ["node_modules/**", ".git/**", "dist/**", "build/**"],
    });

    const files = matches.filter(m => {
      const stat = statSync(resolve(fullPath, m));
      return stat.isFile();
    });

    const directories = matches.filter(m => {
      const stat = statSync(resolve(fullPath, m));
      return stat.isDirectory();
    });

    const result: FileListResult = {
      path,
      files: files.slice(0, 100), // Cap at 100 files
      directories: directories.slice(0, 50),
    };

    return JSON.stringify(result);
  } catch (err) {
    throw new Error(`Failed to list ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const LIST_FILES_MANIFEST = {
  name: "list_files",
  description: "List files matching a glob pattern. Ignores node_modules, .git, dist.",
  requiresState: ["ONLINE", "LIMBO"],
  requiresTier: ["verified", "sealed"],
};

export const LIST_FILES_SCHEMA = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Directory path relative to project root (default: '.')",
    },
    pattern: {
      type: "string",
      description: "Glob pattern (default: '**/*'). Examples: '**/*.ts', 'src/**'",
    },
    maxDepth: {
      type: "number",
      description: "Maximum directory depth (default: 3)",
    },
  },
};
```

---

## Phase 3: Code Execution Tools (12 hours)

### 3.1 Run Command Tool

**Location:** `packages/gateway-core/src/tools/code/run-command.ts`

```typescript
import { execSync } from "node:child_process";
import type { ToolHandler } from "../../tool-registry.js";
import type { CommandResult } from "../types.js";

// Whitelist of safe commands
const ALLOWED_COMMANDS = [
  "npm",
  "pnpm",
  "node",
  "git",
  "vitest",
  "tsc",
  "eslint",
];

export const runCommandTool: ToolHandler = async (input) => {
  const { command, args = [], timeout = 30000 } = input as {
    command: string;
    args?: string[];
    timeout?: number;
  };

  if (!command) throw new Error("command is required");

  const cmd = command.split(" ")[0];
  if (!ALLOWED_COMMANDS.includes(cmd)) {
    throw new Error(`Command not allowed: ${cmd}`);
  }

  try {
    const fullCmd = [command, ...args].join(" ");
    const stdout = execSync(fullCmd, {
      timeout,
      encoding: "utf-8",
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const result: CommandResult = {
      command: fullCmd,
      stdout: stdout.slice(0, 8192), // Cap output
      stderr: "",
      exitCode: 0,
    };

    return JSON.stringify(result);
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    const exitCode = (err as any).status ?? 1;

    return JSON.stringify({
      command: [command, ...args].join(" "),
      stdout: "",
      stderr: stderr.slice(0, 2048),
      exitCode,
    });
  }
};

export const RUN_COMMAND_MANIFEST = {
  name: "run_command",
  description: "Execute a safe command (npm, git, vitest, tsc, eslint, node). Sealed tier only.",
  requiresState: ["ONLINE"],
  requiresTier: ["sealed"],
  sizeCapBytes: 16384,
};

export const RUN_COMMAND_SCHEMA = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description: "Command to execute (npm, pnpm, node, git, vitest, tsc, eslint)",
      enum: ALLOWED_COMMANDS,
    },
    args: {
      type: "array",
      items: { type: "string" },
      description: "Command arguments (e.g., ['test', '--run'] for vitest)",
    },
    timeout: {
      type: "number",
      description: "Timeout in milliseconds (default: 30000)",
    },
  },
  required: ["command"],
};
```

### 3.2 Run Tests Tool

**Location:** `packages/gateway-core/src/tools/code/run-tests.ts`

```typescript
import { execSync } from "node:child_process";
import type { ToolHandler } from "../../tool-registry.js";

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  output: string;
}

export const runTestsTool: ToolHandler = async (input) => {
  const { pattern = "src/**/*.test.ts", watch = false } = input as {
    pattern?: string;
    watch?: boolean;
  };

  try {
    const args = [
      "vitest",
      "run",
      "--reporter=json",
      `--include="${pattern}"`,
    ];

    if (watch) {
      args.push("--watch");
    }

    const output = execSync(args.join(" "), {
      timeout: 120000, // 2 min for tests
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    // Parse vitest JSON output
    let testJson;
    try {
      testJson = JSON.parse(output);
    } catch {
      testJson = { testFiles: [] };
    }

    const result: TestResult = {
      passed: testJson.numPassedTests ?? 0,
      failed: testJson.numFailedTests ?? 0,
      skipped: testJson.numSkippedTests ?? 0,
      duration: testJson.testDuration ?? 0,
      output: output.slice(0, 4096),
    };

    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({
      passed: 0,
      failed: 1,
      skipped: 0,
      duration: 0,
      output: err instanceof Error ? err.message : String(err),
    });
  }
};

export const RUN_TESTS_MANIFEST = {
  name: "run_tests",
  description: "Run tests with vitest. Returns count of passed/failed/skipped and output.",
  requiresState: ["ONLINE"],
  requiresTier: ["sealed"],
  sizeCapBytes: 8192,
};

export const RUN_TESTS_SCHEMA = {
  type: "object",
  properties: {
    pattern: {
      type: "string",
      description: "File pattern for tests (default: 'src/**/*.test.ts')",
    },
    watch: {
      type: "boolean",
      description: "If true, run in watch mode (default: false)",
    },
  },
};
```

---

## Phase 4: Git Tools (12 hours)

### 4.1 Git Log Tool

**Location:** `packages/gateway-core/src/tools/git/log.ts`

```typescript
import { execSync } from "node:child_process";
import type { ToolHandler } from "../../tool-registry.js";
import type { GitLogResult } from "../types.js";

export const gitLogTool: ToolHandler = async (input) => {
  const { limit = 10, file = undefined } = input as {
    limit?: number;
    file?: string;
  };

  if (limit < 1 || limit > 100) {
    throw new Error("limit must be between 1 and 100");
  }

  try {
    const args = [
      "git",
      "log",
      `-n ${limit}`,
      "--pretty=format:%H|%an|%ai|%s",
    ];

    if (file) {
      args.push(`-- ${file}`);
    }

    const output = execSync(args.join(" "), {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    const commits = output.split("\n").map(line => {
      const [hash, author, timestamp, message] = line.split("|");
      return { hash, author, timestamp, message };
    }).filter(c => c.hash);

    const result: GitLogResult = {
      commits,
      total: commits.length,
    };

    return JSON.stringify(result);
  } catch (err) {
    throw new Error(`Failed to get git log: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const GIT_LOG_MANIFEST = {
  name: "git_log",
  description: "Show recent commits. Verified tier and above.",
  requiresState: ["ONLINE"],
  requiresTier: ["verified", "sealed"],
};

export const GIT_LOG_SCHEMA = {
  type: "object",
  properties: {
    limit: {
      type: "number",
      description: "Number of commits to show (1-100, default: 10)",
    },
    file: {
      type: "string",
      description: "Optional file path to show commits for that file only",
    },
  },
};
```

### 4.2 Git Commit Tool

**Location:** `packages/gateway-core/src/tools/git/commit.ts`

```typescript
import { execSync } from "node:child_process";
import type { ToolHandler } from "../../tool-registry.js";

export interface GitCommitResult {
  hash: string;
  message: string;
  timestamp: string;
}

export const gitCommitTool: ToolHandler = async (input) => {
  const { message, coaFingerprint } = input as {
    message: string;
    coaFingerprint?: string;
  };

  if (!message) throw new Error("message is required");

  try {
    // Check if there are changes to commit
    const status = execSync("git status --short", { encoding: "utf-8" });
    if (!status.trim()) {
      throw new Error("No changes to commit");
    }

    // Stage all changes
    execSync("git add -A", { cwd: process.cwd() });

    // Build commit message with COA fingerprint
    let fullMessage = message;
    if (coaFingerprint) {
      fullMessage += `\n\nCoA: ${coaFingerprint}`;
    }

    // Commit
    execSync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
      cwd: process.cwd(),
    });

    // Get the new commit hash
    const hash = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();

    const result: GitCommitResult = {
      hash,
      message: fullMessage,
      timestamp: new Date().toISOString(),
    };

    return JSON.stringify(result);
  } catch (err) {
    throw new Error(`Failed to commit: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const GIT_COMMIT_MANIFEST = {
  name: "git_commit",
  description: "Commit staged changes with a message. Sealed tier only. Includes COA fingerprint.",
  requiresState: ["ONLINE"],
  requiresTier: ["sealed"],
};

export const GIT_COMMIT_SCHEMA = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Commit message (will include COA fingerprint automatically)",
    },
    coaFingerprint: {
      type: "string",
      description: "Optional COA chain fingerprint to include in commit",
    },
  },
  required: ["message"],
};
```

---

## Phase 5: Tool Registration (6 hours)

### 5.1 Create Tool Index

**Location:** `packages/gateway-core/src/tools/index.ts`

```typescript
export { readFileTool, READ_FILE_MANIFEST, READ_FILE_SCHEMA } from "./file/read.js";
export { writeFileTool, WRITE_FILE_MANIFEST, WRITE_FILE_SCHEMA } from "./file/write.js";
export { listFilesTool, LIST_FILES_MANIFEST, LIST_FILES_SCHEMA } from "./file/list.js";
export { runCommandTool, RUN_COMMAND_MANIFEST, RUN_COMMAND_SCHEMA } from "./code/run-command.js";
export { runTestsTool, RUN_TESTS_MANIFEST, RUN_TESTS_SCHEMA } from "./code/run-tests.js";
export { gitLogTool, GIT_LOG_MANIFEST, GIT_LOG_SCHEMA } from "./git/log.js";
export { gitCommitTool, GIT_COMMIT_MANIFEST, GIT_COMMIT_SCHEMA } from "./git/commit.js";

export * from "./types.js";
```

### 5.2 Register Tools in Server Bootstrap

**Location:** `packages/gateway-core/src/server.ts` (modify ~line 175)

```typescript
import {
  readFileTool, READ_FILE_MANIFEST, READ_FILE_SCHEMA,
  writeFileTool, WRITE_FILE_MANIFEST, WRITE_FILE_SCHEMA,
  listFilesTool, LIST_FILES_MANIFEST, LIST_FILES_SCHEMA,
  runCommandTool, RUN_COMMAND_MANIFEST, RUN_COMMAND_SCHEMA,
  runTestsTool, RUN_TESTS_MANIFEST, RUN_TESTS_SCHEMA,
  gitLogTool, GIT_LOG_MANIFEST, GIT_LOG_SCHEMA,
  gitCommitTool, GIT_COMMIT_MANIFEST, GIT_COMMIT_SCHEMA,
} from "./tools/index.js";

// ... existing code ...

const rateLimiter = new RateLimiter();
const toolRegistry = new ToolRegistry();
toolRegistry.setCOALogger(coaLogger);

// Register all tools
toolRegistry.register(READ_FILE_MANIFEST, readFileTool, READ_FILE_SCHEMA);
toolRegistry.register(WRITE_FILE_MANIFEST, writeFileTool, WRITE_FILE_SCHEMA);
toolRegistry.register(LIST_FILES_MANIFEST, listFilesTool, LIST_FILES_SCHEMA);
toolRegistry.register(RUN_COMMAND_MANIFEST, runCommandTool, RUN_COMMAND_SCHEMA);
toolRegistry.register(RUN_TESTS_MANIFEST, runTestsTool, RUN_TESTS_SCHEMA);
toolRegistry.register(GIT_LOG_MANIFEST, gitLogTool, GIT_LOG_SCHEMA);
toolRegistry.register(GIT_COMMIT_MANIFEST, gitCommitTool, GIT_COMMIT_SCHEMA);
```

---

## Phase 6: Testing (4 hours)

### 6.1 Test File Tools

**Location:** `packages/gateway-core/src/tools.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { readFileTool } from "./tools/index.js";

describe("Tools", () => {
  describe("read_file", () => {
    it("reads a file successfully", async () => {
      const result = await readFileTool({ path: "package.json" });
      const parsed = JSON.parse(result);
      expect(parsed.path).toBe("package.json");
      expect(parsed.bytes).toBeGreaterThan(0);
    });

    it("rejects paths outside project", async () => {
      expect(() => readFileTool({ path: "../../../etc/passwd" }))
        .rejects.toThrow("Access denied");
    });
  });

  // Add similar tests for other tools
});
```

---

## Phase 7: Documentation (2 hours)

### 7.1 Tools Reference

Create `docs/agent-tools.md`:

```markdown
# Agent Tools Reference

## File Tools

### read_file
Read file content from the project.

**Input:**
- path: string (required) — file path relative to project root
- encoding: string (optional) — default: utf-8

**Output:**
```json
{
  "path": "src/index.ts",
  "content": "...",
  "lines": 42,
  "bytes": 1024
}
```

### write_file
Write or append content to a file. Sealed tier only.

[... similar documentation for other tools ...]
```

---

## Implementation Checklist

- [ ] Create tool directory structure
- [ ] Define tool types (TypeScript interfaces)
- [ ] Implement read_file tool
- [ ] Implement write_file tool
- [ ] Implement list_files tool
- [ ] Implement run_command tool (with command whitelist)
- [ ] Implement run_tests tool
- [ ] Implement git_log tool
- [ ] Implement git_commit tool
- [ ] Create tool index (export all)
- [ ] Register tools in server.ts
- [ ] Write unit tests for each tool
- [ ] Test tool execution through agent
- [ ] Document all tools
- [ ] Update system prompt to mention tools

---

## Next Steps After Tools

1. **Integrate BOTS** — Create `queue_background_task` tool
2. **Wire memory** — Inject memory into system prompt
3. **Load workspace context** — Read SOUL.md, AGENTS.md
4. **Create skill library** — Example skills for common tasks

---

## Security Considerations

- All file paths are resolved and validated to prevent directory traversal
- Commands are whitelisted (npm, git, vitest, etc.)
- Command execution timeout is 30 seconds (configurable)
- Output is capped (file: 64 KB, command: 16 KB)
- Tool use is logged with COA fingerprints
- Tools are tier-gated (read=verified, write=sealed)
