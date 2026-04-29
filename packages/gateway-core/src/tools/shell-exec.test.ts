/**
 * shell-exec — server-start pattern guard tests (Phase 5).
 *
 * Validates that detectServerStart correctly flags long-running server
 * commands and lets ordinary one-shot commands pass. These are the
 * semantics the agent relies on when deciding whether to use shell_exec
 * vs. manage_project.
 */

import { describe, it, expect } from "vitest";
import { detectServerStart, createShellExecHandler, SHELL_EXEC_MANIFEST } from "./shell-exec.js";

describe("detectServerStart — server pattern guard", () => {
  const serverCommands = [
    { cmd: "npm run dev", label: "npm/pnpm/yarn dev-server" },
    { cmd: "pnpm dev", label: "npm/pnpm/yarn dev-server" },
    { cmd: "yarn start", label: "npm/pnpm/yarn dev-server" },
    { cmd: "pnpm run serve", label: "npm/pnpm/yarn dev-server" },
    { cmd: "next dev", label: "JS framework dev server" },
    { cmd: "vite dev", label: "JS framework dev server" },
    { cmd: "nuxt dev", label: "JS framework dev server" },
    { cmd: "astro dev", label: "JS framework dev server" },
    { cmd: "nodemon src/index.ts", label: "nodemon" },
    { cmd: "pm2 start ecosystem.config.js", label: "pm2 start" },
    { cmd: "python -m http.server 8000", label: "python http.server" },
    { cmd: "flask run --host 0.0.0.0", label: "flask run" },
    { cmd: "uvicorn app:api --reload", label: "uvicorn" },
    { cmd: "gunicorn app.wsgi", label: "gunicorn" },
    { cmd: "rails server", label: "rails server" },
    { cmd: "rails s -p 4000", label: "rails server" },
    { cmd: "php -S 0.0.0.0:8000", label: "php -S" },
    { cmd: "nc -l 8080", label: "netcat listener" },
  ];

  for (const { cmd, label } of serverCommands) {
    it(`flags "${cmd}" as ${label}`, () => {
      const result = detectServerStart(cmd);
      expect(result.matched).toBe(true);
      if (result.matched) expect(result.label).toBe(label);
    });
  }

  const oneShotCommands = [
    "ls",
    "ls -la",
    "cat package.json",
    "grep -r 'foo' src/",
    "git status",
    "git log --oneline -5",
    "npm install",
    "npm install express",
    "pnpm install --frozen-lockfile",
    "pnpm build",
    "pnpm run build",
    "yarn install",
    "cargo build",
    "python setup.py install",
    "python -c 'print(1)'",
    "make test",
    "docker ps",
    "podman ps",
    "echo hello",
    "pwd",
  ];

  for (const cmd of oneShotCommands) {
    it(`allows one-shot "${cmd}"`, () => {
      expect(detectServerStart(cmd).matched).toBe(false);
    });
  }
});

describe("createShellExecHandler — server-start rejection", () => {
  it("rejects a server-start command with a helpful error pointing at manage_project", async () => {
    const handler = createShellExecHandler({ workspaceRoot: "/tmp", blockServerStart: true });
    const result = JSON.parse(await handler({ command: "npm run dev" })) as { exitCode: number; error: string };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("manage_project");
    expect(result.error).toContain("container");
  });

  it("honors blockServerStart:false to allow server-start commands (bypass)", async () => {
    // We don't actually want the command to run, so pair with an invalid workspaceRoot
    // that the cwd check will NOT reject (since cwd defaults to workspaceRoot and startsWith passes).
    // The exec will fail/timeout but that's fine — we just assert the server-start check
    // doesn't short-circuit when disabled.
    const handler = createShellExecHandler({ workspaceRoot: "/tmp", blockServerStart: false });
    const result = JSON.parse(await handler({
      command: "npm run dev",
      timeout_ms: 100,
    })) as { error?: string; exitCode: number };
    // If the server-start check had run, error would mention manage_project.
    expect(result.error ?? "").not.toContain("manage_project");
  });

  it("still rejects destructive commands regardless of server-start flag", async () => {
    const handler = createShellExecHandler({ workspaceRoot: "/tmp", blockServerStart: false });
    const result = JSON.parse(await handler({ command: "shutdown now" })) as { exitCode: number; error: string };
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain("Blocked command");
  });

  it("manifest description warns the LLM about server-start restrictions", () => {
    expect(SHELL_EXEC_MANIFEST.description).toContain("long-running servers");
    expect(SHELL_EXEC_MANIFEST.description).toContain("manage_project");
    expect(SHELL_EXEC_MANIFEST.description).toMatch(/npm run dev|vite|next dev/);
  });

  // -------------------------------------------------------------------------
  // s130 t515 slice 6 — chat tool cage gating
  // -------------------------------------------------------------------------

  describe("cage gating (s130 t515 slice 6)", () => {
    it("falls back to workspaceRoot check when cageProvider is undefined (legacy)", async () => {
      const handler = createShellExecHandler({ workspaceRoot: "/tmp" });
      const result = JSON.parse(await handler({
        command: "echo ok",
        cwd: "/etc",
      })) as { error?: string; exitCode: number };
      expect(result.error).toContain("escapes workspace boundary");
    });

    it("falls back to workspaceRoot check when cageProvider returns null (no projectContext)", async () => {
      const handler = createShellExecHandler({
        workspaceRoot: "/tmp",
        cageProvider: () => null,
      });
      const result = JSON.parse(await handler({
        command: "echo ok",
        cwd: "/etc",
      })) as { error?: string; exitCode: number };
      expect(result.error).toContain("escapes workspace boundary");
    });

    it("rejects cwd OUTSIDE cage when cage is set", async () => {
      const handler = createShellExecHandler({
        workspaceRoot: "/tmp",
        cageProvider: () => ({
          allowedPrefixes: ["/home/user/myproject"],
          opsModeWidened: false,
          askUserQuestionEscape: true,
        }),
      });
      const result = JSON.parse(await handler({
        command: "echo ok",
        cwd: "/etc",
      })) as { error?: string; exitCode: number };
      expect(result.exitCode).toBe(-1);
      expect(result.error).toContain("outside the project cage");
    });

    it("rejects cage-outside cwd even when it's INSIDE workspaceRoot (cage is stricter)", async () => {
      // /tmp is in workspaceRoot=/tmp but NOT in cage=/home/user/myproject
      // — cage wins.
      const handler = createShellExecHandler({
        workspaceRoot: "/tmp",
        cageProvider: () => ({
          allowedPrefixes: ["/home/user/myproject"],
          opsModeWidened: false,
          askUserQuestionEscape: true,
        }),
      });
      const result = JSON.parse(await handler({
        command: "echo ok",
        cwd: "/tmp",
      })) as { error?: string; exitCode: number };
      expect(result.error).toContain("outside the project cage");
    });

    it("allows cwd INSIDE cage (skips workspaceRoot fallback)", async () => {
      // Cage takes precedence over workspaceRoot — when cage check passes,
      // the workspaceRoot fallback is skipped. /tmp is in cage but not in
      // workspaceRoot=/var/empty.
      const handler = createShellExecHandler({
        workspaceRoot: "/var/empty",
        cageProvider: () => ({
          allowedPrefixes: ["/tmp"],
          opsModeWidened: false,
          askUserQuestionEscape: true,
        }),
      });
      const result = JSON.parse(await handler({
        command: "true",
        cwd: "/tmp",
      })) as { error?: string; exitCode: number };
      // Cage passed; we shouldn't see either rejection error.
      expect(result.error ?? "").not.toContain("escapes workspace boundary");
      expect(result.error ?? "").not.toContain("outside the project cage");
    });
  });
});
