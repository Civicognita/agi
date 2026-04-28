/**
 * tRPC Router — type-safe API procedures for the Aionima dashboard.
 *
 * Procedure groups:
 *   dashboard.*  — impact metrics, timeline, breakdown, leaderboard, entity, COA
 *   projects.*   — workspace project CRUD + git actions
 *   config.*     — gateway.json read/write
 *   system.*     — update check + upgrade trigger
 *   plans.*      — plan CRUD
 *   taskmaster.* — work queue
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { readFileSync, writeFileSync } from "node:fs";
import { router, publicProcedure } from "./trpc.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const timeBucketSchema = z.enum(["hour", "day", "week", "month"]);
const breakdownDimensionSchema = z.enum(["domain", "channel", "workType"]);

// ---------------------------------------------------------------------------
// Dashboard procedures (read-only, backed by DashboardQueries)
// ---------------------------------------------------------------------------

const dashboardRouter = router({
  overview: publicProcedure
    .input(z.object({
      windowDays: z.number().int().positive().default(90),
      recentLimit: z.number().int().positive().default(20),
    }))
    .query(({ ctx, input }) => {
      return ctx.queries.getOverview(input.windowDays, input.recentLimit);
    }),

  timeline: publicProcedure
    .input(z.object({
      bucket: timeBucketSchema.default("day"),
      entityId: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
    }))
    .query(({ ctx, input }) => {
      const buckets = ctx.queries.getTimeline(
        input.bucket,
        input.entityId,
        input.since,
        input.until,
      );
      return {
        buckets,
        bucket: input.bucket,
        since: input.since ?? "all-time",
        until: input.until ?? "now",
      };
    }),

  breakdown: publicProcedure
    .input(z.object({
      by: breakdownDimensionSchema.default("domain"),
      entityId: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { slices, total } = await ctx.queries.getBreakdown(
        input.by,
        input.entityId,
        input.since,
        input.until,
      );
      return { dimension: input.by, slices, total };
    }),

  leaderboard: publicProcedure
    .input(z.object({
      windowDays: z.number().int().positive().default(90),
      limit: z.number().int().positive().default(25),
      offset: z.number().int().nonnegative().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const { entries, total } = await ctx.queries.getLeaderboard(
        input.windowDays,
        input.limit,
        input.offset,
      );
      return {
        entries,
        windowDays: input.windowDays,
        total,
        computedAt: new Date().toISOString(),
      };
    }),

  entityProfile: publicProcedure
    .input(z.object({
      id: z.string().min(1),
      windowDays: z.number().int().positive().default(90),
    }))
    .query(({ ctx, input }) => {
      const profile = ctx.queries.getEntityProfile(input.id, input.windowDays);
      if (profile === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
      }
      return profile;
    }),

  coa: publicProcedure
    .input(z.object({
      entityId: z.string().optional(),
      fingerprint: z.string().optional(),
      workType: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      limit: z.number().int().positive().default(50),
      offset: z.number().int().nonnegative().default(0),
    }))
    .query(({ ctx, input }) => {
      return ctx.queries.getCOAEntries(input);
    }),
});

// ---------------------------------------------------------------------------
// Config procedures
// ---------------------------------------------------------------------------

const configRouter = router({
  get: publicProcedure.query(({ ctx }) => {
    if (!ctx.configPath) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Config not available" });
    }
    const raw = readFileSync(ctx.configPath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  }),

  save: publicProcedure
    .input(z.record(z.unknown()))
    .mutation(({ ctx, input }) => {
      if (!ctx.configPath) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Config not available" });
      }
      writeFileSync(ctx.configPath, JSON.stringify(input, null, 2) + "\n", "utf-8");
      return { ok: true, message: "Config saved. Restart gateway to apply changes." };
    }),
});

// ---------------------------------------------------------------------------
// System procedures
// ---------------------------------------------------------------------------

const systemRouter = router({
  checkUpdates: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.selfRepoPath) {
      return {
        updateAvailable: false,
        localCommit: "",
        remoteCommit: "",
        behindCount: 0,
        commits: [] as { hash: string; message: string }[],
      };
    }
    // Import the git helper at runtime to avoid bundling issues
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const execFileAsync = promisify(execFile);

    const exec = async (args: string[], cwd: string) => {
      try {
        const { stdout, stderr } = await execFileAsync("git", args, {
          cwd,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
        return { stdout: stdout.trim(), stderr, exitCode: 0 };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number };
        return {
          stdout: typeof e.stdout === "string" ? e.stdout.trim() : "",
          stderr: typeof e.stderr === "string" ? e.stderr : "",
          exitCode: typeof e.code === "number" ? e.code : 1,
        };
      }
    };

    const repoPath = ctx.selfRepoPath;
    const repoHead = await exec(["rev-parse", "HEAD"], repoPath);
    const repoCommit = repoHead.stdout;

    // Check for .deployed-commit marker
    let deployedCommit = "";
    const markerPath = join(process.cwd(), ".deployed-commit");
    if (existsSync(markerPath)) {
      deployedCommit = readFileSync(markerPath, "utf-8").trim();
    }

    if (!deployedCommit) {
      // Fallback to remote tracking
      await exec(["fetch", "--all", "--prune"], repoPath);
      const remote = await exec(["rev-parse", "@{u}"], repoPath);
      deployedCommit = remote.stdout;
      const countResult = await exec(["rev-list", "HEAD..@{u}", "--count"], repoPath);
      const behindCount = parseInt(countResult.stdout, 10) || 0;
      let commits: { hash: string; message: string }[] = [];
      if (behindCount > 0) {
        const logResult = await exec(["log", "HEAD..@{u}", "--oneline"], repoPath);
        commits = logResult.stdout.split("\n").filter(Boolean).map((line) => {
          const spaceIdx = line.indexOf(" ");
          return {
            hash: spaceIdx > 0 ? line.slice(0, spaceIdx) : line,
            message: spaceIdx > 0 ? line.slice(spaceIdx + 1) : "",
          };
        });
      }
      return { updateAvailable: behindCount > 0, localCommit: repoCommit, remoteCommit: deployedCommit, behindCount, commits };
    }

    if (deployedCommit === repoCommit) {
      return { updateAvailable: false, localCommit: deployedCommit, remoteCommit: repoCommit, behindCount: 0, commits: [] as { hash: string; message: string }[] };
    }

    const countResult = await exec(["rev-list", `${deployedCommit}..HEAD`, "--count"], repoPath);
    const behindCount = parseInt(countResult.stdout, 10) || 0;
    let commits: { hash: string; message: string }[] = [];
    if (behindCount > 0) {
      const logResult = await exec(["log", `${deployedCommit}..HEAD`, "--oneline"], repoPath);
      commits = logResult.stdout.split("\n").filter(Boolean).map((line) => {
        const spaceIdx = line.indexOf(" ");
        return {
          hash: spaceIdx > 0 ? line.slice(0, spaceIdx) : line,
          message: spaceIdx > 0 ? line.slice(spaceIdx + 1) : "",
        };
      });
    }
    return { updateAvailable: behindCount > 0, localCommit: deployedCommit, remoteCommit: repoCommit, behindCount, commits };
  }),

  upgrade: publicProcedure.mutation(async ({ ctx }) => {
    if (!ctx.selfRepoPath) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "selfRepo not configured" });
    }
    const { spawn } = await import("node:child_process");
    const { join } = await import("node:path");

    const repoPath = ctx.selfRepoPath;
    const scriptPath = join(repoPath, "scripts/upgrade.sh");

    // Fire-and-forget the deploy script; broadcast progress via WS
    const child = spawn("bash", [scriptPath], { cwd: repoPath, stdio: ["ignore", "pipe", "pipe"] });

    let currentPhase = "pulling";
    const phaseMap: Record<string, string> = {
      "Pulling": "pulling",
      "Checking system": "dependencies",
      "Building": "building",
      "Syncing": "syncing",
      "Updating systemd": "restarting",
      "Backend changed": "restarting",
      "Backend unchanged": "complete",
      "Deploy complete": "complete",
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        const arrowMatch = line.match(/^==> (.+?)\.{3}$/);
        if (arrowMatch) {
          const label = arrowMatch[1]!;
          for (const [key, phase] of Object.entries(phaseMap)) {
            if (label.startsWith(key)) { currentPhase = phase; break; }
          }
        }
        ctx.broadcastUpgrade(currentPhase, line.replace(/^==> /, ""));
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      ctx.broadcastUpgrade(currentPhase, chunk.toString("utf-8").trim());
    });

    child.on("close", (code) => {
      if (code === 0) {
        ctx.broadcastUpgrade("complete", "Deploy complete");
      } else {
        ctx.broadcastUpgrade("error", `Deploy failed with exit code ${code}`);
      }
    });

    child.on("error", (err) => {
      ctx.broadcastUpgrade("error", `Deploy error: ${err.message}`);
    });

    return { ok: true, message: "Upgrade started" };
  }),
});

// ---------------------------------------------------------------------------
// Root router
// ---------------------------------------------------------------------------

export const appRouter = router({
  dashboard: dashboardRouter,
  config: configRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
