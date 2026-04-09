import { describe, it, expect } from "vitest";
import type { StackContainerContext, StackContainerConfig, StackDevCommands } from "./stack-types.js";

// ---------------------------------------------------------------------------
// Helpers — replicate command patterns from stack plugins
// ---------------------------------------------------------------------------

function nextjsCommand(ctx: StackContainerContext): string[] | null {
  if (ctx.mode === "development") return ["npm", "run", "dev"];
  return ["sh", "-c", "npm run build && npm start"];
}

function nodeAppCommand(ctx: StackContainerContext): string[] | null {
  if (ctx.mode === "development") return ["npm", "run", "dev"];
  return ["npm", "start"];
}

function laravelCommand(ctx: StackContainerContext): string[] | null {
  if (ctx.mode === "development") {
    return ["php", "artisan", "serve", "--host=0.0.0.0", "--port=80"];
  }
  return [
    "bash", "-c",
    "sed -i 's|/var/www/html|/var/www/html/public|g' /etc/apache2/sites-available/000-default.conf /etc/apache2/apache2.conf && a2enmod rewrite && docker-php-entrypoint apache2-foreground",
  ];
}

/** Simulate the devCommands fallback in hosting-manager.ts */
function resolveCommand(
  command: StackContainerConfig["command"],
  devCommands: StackDevCommands | undefined,
  ctx: StackContainerContext,
): string[] | null {
  const cmdTokens = command?.(ctx) ?? null;
  if (cmdTokens) return cmdTokens;

  if (devCommands) {
    const cmd = ctx.mode === "development"
      ? devCommands.dev
      : devCommands.start;
    if (cmd) return ["sh", "-c", cmd];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const baseCtx: StackContainerContext = {
  projectPath: "/tmp/test-project",
  projectHostname: "test",
  allocatedPort: 4000,
  mode: "production",
};

describe("Mode-aware command resolution", () => {
  describe("Next.js stack", () => {
    it("returns npm run dev for development mode", () => {
      expect(nextjsCommand({ ...baseCtx, mode: "development" }))
        .toEqual(["npm", "run", "dev"]);
    });

    it("returns build+start for production mode", () => {
      expect(nextjsCommand({ ...baseCtx, mode: "production" }))
        .toEqual(["sh", "-c", "npm run build && npm start"]);
    });
  });

  describe("Node.js app stack", () => {
    it("returns npm run dev for development mode", () => {
      expect(nodeAppCommand({ ...baseCtx, mode: "development" }))
        .toEqual(["npm", "run", "dev"]);
    });

    it("returns npm start for production mode", () => {
      expect(nodeAppCommand({ ...baseCtx, mode: "production" }))
        .toEqual(["npm", "start"]);
    });
  });

  describe("Laravel stack", () => {
    it("returns artisan serve for development mode", () => {
      expect(laravelCommand({ ...baseCtx, mode: "development" }))
        .toEqual(["php", "artisan", "serve", "--host=0.0.0.0", "--port=80"]);
    });

    it("returns Apache with docRoot rewrite for production mode", () => {
      const cmd = laravelCommand({ ...baseCtx, mode: "production" });
      expect(cmd?.[0]).toBe("bash");
      expect(cmd?.[2]).toContain("apache2-foreground");
    });
  });

  describe("devCommands fallback", () => {
    const devCommands: StackDevCommands = {
      dev: "npm run dev",
      build: "npm run build",
      start: "npm start",
    };

    it("uses command() when it returns a value", () => {
      const result = resolveCommand(nextjsCommand, devCommands, { ...baseCtx, mode: "development" });
      expect(result).toEqual(["npm", "run", "dev"]);
    });

    it("falls back to devCommands.dev when command is undefined in development", () => {
      const result = resolveCommand(undefined, devCommands, { ...baseCtx, mode: "development" });
      expect(result).toEqual(["sh", "-c", "npm run dev"]);
    });

    it("falls back to devCommands.start when command is undefined in production", () => {
      const result = resolveCommand(undefined, devCommands, { ...baseCtx, mode: "production" });
      expect(result).toEqual(["sh", "-c", "npm start"]);
    });

    it("returns null when both command and devCommands are undefined", () => {
      const result = resolveCommand(undefined, undefined, baseCtx);
      expect(result).toBeNull();
    });

    it("falls back when command() returns null", () => {
      const nullCommand = () => null;
      const result = resolveCommand(nullCommand, devCommands, { ...baseCtx, mode: "development" });
      expect(result).toEqual(["sh", "-c", "npm run dev"]);
    });
  });
});
