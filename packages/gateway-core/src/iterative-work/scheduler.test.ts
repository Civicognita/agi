import { describe, expect, it, vi } from "vitest";
import { IterativeWorkScheduler } from "./scheduler.js";
import type { ProjectConfigManager } from "../project-config-manager.js";
import type { ProjectConfig } from "@agi/config";

function makeConfigManager(configsByPath: Record<string, Partial<ProjectConfig> | null>): ProjectConfigManager {
  return {
    read: (projectPath: string) => (configsByPath[projectPath] ?? null) as ProjectConfig | null,
  } as unknown as ProjectConfigManager;
}

function captureFires(scheduler: IterativeWorkScheduler): Array<{ projectPath: string; cron: string }> {
  const fires: Array<{ projectPath: string; cron: string }> = [];
  scheduler.on("fire", (fire) => {
    fires.push({ projectPath: fire.projectPath, cron: fire.cron });
  });
  return fires;
}

describe("IterativeWorkScheduler.tick", () => {
  it("fires for projects with iterativeWork.enabled and a parseable cron", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
        "/p/b": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a", "/p/b"],
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));

    expect(fires).toEqual([
      { projectPath: "/p/a", cron: "* * * * *" },
      { projectPath: "/p/b", cron: "* * * * *" },
    ]);
  });

  it("skips projects without iterativeWork or with enabled=false", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/off": { iterativeWork: { enabled: false, cron: "* * * * *" } },
        "/p/missing": {},
        "/p/null": null,
      }),
      listProjectPaths: () => ["/p/off", "/p/missing", "/p/null"],
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));

    expect(fires).toEqual([]);
  });

  it("skips projects with enabled=true but no cron (manual-fire only)", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/manual": { iterativeWork: { enabled: true } },
        "/p/empty": { iterativeWork: { enabled: true, cron: "   " } },
      }),
      listProjectPaths: () => ["/p/manual", "/p/empty"],
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));

    expect(fires).toEqual([]);
  });

  it("skips projects with unparseable cron + logs a warning", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/bad": { iterativeWork: { enabled: true, cron: "0 9-17 * * 1-5" } },
      }),
      listProjectPaths: () => ["/p/bad"],
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));

    expect(fires).toEqual([]);
  });

  it("does not re-fire a project still marked in-flight (idempotency)", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    scheduler.tick(new Date("2026-04-27T05:31:30.000Z"));
    scheduler.tick(new Date("2026-04-27T05:32:30.000Z"));

    expect(fires).toHaveLength(1);
    expect(scheduler.getInFlight()).toEqual(["/p/a"]);
  });

  it("re-fires after markComplete + the next cron-due tick", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    expect(scheduler.getInFlight()).toEqual(["/p/a"]);

    scheduler.markComplete("/p/a");
    expect(scheduler.getInFlight()).toEqual([]);

    scheduler.tick(new Date("2026-04-27T05:31:30.000Z"));
    expect(fires).toHaveLength(2);
    expect(scheduler.getInFlight()).toEqual(["/p/a"]);
  });

  it("does not double-fire within the same minute even after markComplete", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "0 * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:00:30.000Z"));
    scheduler.markComplete("/p/a");
    scheduler.tick(new Date("2026-04-27T05:00:45.000Z"));
    scheduler.tick(new Date("2026-04-27T05:30:00.000Z"));

    expect(fires).toHaveLength(1);
  });

  it("hot-reloads project config — disabling stops fires on next tick", () => {
    const configs: Record<string, Partial<ProjectConfig> | null> = {
      "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
    };
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager(configs),
      listProjectPaths: () => ["/p/a"],
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    scheduler.markComplete("/p/a");

    configs["/p/a"] = { iterativeWork: { enabled: false } };

    scheduler.tick(new Date("2026-04-27T05:31:30.000Z"));

    expect(fires).toHaveLength(1);
  });

  it("listProjectPaths is called fresh on each tick (newly-created projects pick up)", () => {
    const list = vi.fn(() => ["/p/a"]);
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: list,
    });

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    scheduler.tick(new Date("2026-04-27T05:31:30.000Z"));

    expect(list).toHaveBeenCalledTimes(2);
  });

  it("falls back to empty enumeration when listProjectPaths is omitted", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));

    expect(fires).toEqual([]);
  });
});

describe("IterativeWorkScheduler.getStatus", () => {
  it("returns null when project has no config", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({ "/p/missing": null }),
    });
    expect(scheduler.getStatus("/p/missing")).toBeNull();
  });

  it("returns enabled=false when iterativeWork is absent", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({ "/p/a": {} }),
    });
    expect(scheduler.getStatus("/p/a")).toEqual({
      enabled: false,
      cron: null,
      cadence: null,
      inFlight: false,
      lastFiredAt: null,
      nextFireAt: null,
    });
  });

  it("returns enabled=true, cron, and computed nextFireAt off `now` when never fired", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "8,38 * * * *" } },
      }),
    });
    const status = scheduler.getStatus("/p/a", new Date("2026-04-27T05:10:00.000Z"));
    expect(status).toEqual({
      enabled: true,
      cron: "8,38 * * * *",
      cadence: null,
      inFlight: false,
      lastFiredAt: null,
      nextFireAt: "2026-04-27T05:38:00.000Z",
    });
  });

  it("computes nextFireAt off lastFiredAt when present", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "*/15 * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });

    scheduler.tick(new Date("2026-04-27T05:00:30.000Z"));
    const status = scheduler.getStatus("/p/a", new Date("2026-04-27T05:30:00.000Z"));

    expect(status?.lastFiredAt).toBe("2026-04-27T05:00:30.000Z");
    expect(status?.nextFireAt).toBe("2026-04-27T05:15:00.000Z");
    expect(status?.inFlight).toBe(true);
  });

  it("returns nextFireAt: null when cron is unparseable but enabled is true", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "0 9-17 * * 1-5" } },
      }),
    });
    const status = scheduler.getStatus("/p/a");
    expect(status?.enabled).toBe(true);
    expect(status?.cron).toBe("0 9-17 * * 1-5");
    expect(status?.nextFireAt).toBeNull();
  });

  it("returns cron: null when cron is empty/whitespace (not just missing)", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "   " } },
      }),
    });
    const status = scheduler.getStatus("/p/a");
    expect(status?.cron).toBeNull();
    expect(status?.nextFireAt).toBeNull();
  });
});

describe("IterativeWorkScheduler iteration log", () => {
  it("pushes a running entry when tick fires", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));

    const log = scheduler.getLog("/p/a");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      firedAt: "2026-04-27T05:30:30.000Z",
      completedAt: null,
      durationMs: null,
      status: "running",
      cron: "* * * * *",
    });
  });

  it("recordCompletion mutates the head entry to done with durationMs", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    scheduler.recordCompletion("/p/a", { status: "done", now: new Date("2026-04-27T05:30:35.500Z") });

    const log = scheduler.getLog("/p/a");
    expect(log[0]).toMatchObject({
      status: "done",
      completedAt: "2026-04-27T05:30:35.500Z",
      durationMs: 5500,
    });
    expect(log[0]?.error).toBeUndefined();
  });

  it("recordCompletion captures error message when status is error", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    scheduler.recordCompletion("/p/a", { status: "error", error: "LLM timeout", now: new Date("2026-04-27T05:31:00.000Z") });

    const log = scheduler.getLog("/p/a");
    expect(log[0]).toMatchObject({
      status: "error",
      error: "LLM timeout",
      durationMs: 30_000,
    });
  });

  it("recordCompletion is a no-op when no running entry exists (out-of-order calls)", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({}),
    });
    scheduler.recordCompletion("/p/a", { status: "done" });
    expect(scheduler.getLog("/p/a")).toEqual([]);
  });

  it("recordCompletion emits a `complete` event carrying the iteration shape (s124 t468)", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    const completions: Array<unknown> = [];
    scheduler.on("complete", (c) => { completions.push(c); });
    scheduler.tick(new Date("2026-04-28T05:30:00.000Z"));
    scheduler.recordCompletion("/p/a", {
      status: "done",
      now: new Date("2026-04-28T05:30:12.000Z"),
      artifact: { summary: "Test ship", commitHash: "abc1234" },
    });
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      projectPath: "/p/a",
      cron: "* * * * *",
      firedAt: "2026-04-28T05:30:00.000Z",
      completedAt: "2026-04-28T05:30:12.000Z",
      durationMs: 12_000,
      status: "done",
      artifact: { summary: "Test ship", commitHash: "abc1234" },
    });
  });

  it("recordCompletion `complete` event includes error field on error status", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    const completions: Array<{ status: string; error?: string }> = [];
    scheduler.on("complete", (c) => { completions.push(c as { status: string; error?: string }); });
    scheduler.tick(new Date("2026-04-28T05:30:00.000Z"));
    scheduler.recordCompletion("/p/a", {
      status: "error",
      error: "test failure",
      now: new Date("2026-04-28T05:30:30.000Z"),
    });
    expect(completions).toHaveLength(1);
    expect(completions[0]?.status).toBe("error");
    expect(completions[0]?.error).toBe("test failure");
  });

  it("recordCompletion does NOT emit `complete` when no running entry exists (no-op)", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({}),
    });
    const completions: Array<unknown> = [];
    scheduler.on("complete", (c) => { completions.push(c); });
    scheduler.recordCompletion("/p/a", { status: "done" });
    expect(completions).toHaveLength(0);
  });

  it("ring buffer caps at logBufferSize, dropping oldest entries", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
      logBufferSize: 3,
    });
    for (let i = 0; i < 5; i += 1) {
      const stamp = new Date(`2026-04-27T05:${String(30 + i).padStart(2, "0")}:30.000Z`);
      scheduler.tick(stamp);
      scheduler.markComplete("/p/a");
      scheduler.recordCompletion("/p/a", { status: "done", now: stamp });
    }
    const log = scheduler.getLog("/p/a");
    expect(log).toHaveLength(3);
    expect(log[0]?.firedAt).toBe("2026-04-27T05:34:30.000Z");
    expect(log[2]?.firedAt).toBe("2026-04-27T05:32:30.000Z");
  });

  it("getLog respects the limit parameter and returns most-recent-first", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    for (let i = 0; i < 4; i += 1) {
      const stamp = new Date(`2026-04-27T05:${String(30 + i).padStart(2, "0")}:30.000Z`);
      scheduler.tick(stamp);
      scheduler.markComplete("/p/a");
      scheduler.recordCompletion("/p/a", { status: "done", now: stamp });
    }
    const log = scheduler.getLog("/p/a", 2);
    expect(log).toHaveLength(2);
    expect(log[0]?.firedAt).toBe("2026-04-27T05:33:30.000Z");
    expect(log[1]?.firedAt).toBe("2026-04-27T05:32:30.000Z");
  });

  it("returns an empty log for projects that have never fired", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({}),
    });
    expect(scheduler.getLog("/p/never")).toEqual([]);
  });
});

describe("IterativeWorkScheduler.start/stop", () => {
  it("start is idempotent — calling twice does not double-tick", () => {
    vi.useFakeTimers();
    try {
      const list = vi.fn(() => ["/p/a"]);
      const scheduler = new IterativeWorkScheduler({
        projectConfigManager: makeConfigManager({
          "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
        }),
        listProjectPaths: list,
        tickIntervalMs: 1000,
      });

      scheduler.start();
      scheduler.start();
      vi.advanceTimersByTime(1000);

      expect(list).toHaveBeenCalledTimes(1);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop clears the in-flight set so a fresh start begins clean", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    expect(scheduler.getInFlight()).toEqual(["/p/a"]);

    scheduler.start();
    scheduler.stop();
    expect(scheduler.getInFlight()).toEqual([]);
  });
});

describe("IterativeWorkScheduler operator kill switch (s159 t692)", () => {
  it("forceClearProject removes the project from in-flight + lastFired tracking", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/runaway": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/runaway"],
    });

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    expect(scheduler.getInFlight()).toEqual(["/p/runaway"]);

    const result = scheduler.forceClearProject("/p/runaway");
    expect(result).toEqual({ wasInFlight: true, hadLastFired: true });
    expect(scheduler.getInFlight()).toEqual([]);
  });

  it("forceClearProject returns wasInFlight=false when project was never in-flight", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({}),
      listProjectPaths: () => [],
    });
    const result = scheduler.forceClearProject("/p/never-fired");
    expect(result).toEqual({ wasInFlight: false, hadLastFired: false });
  });

  it("forceClearProject leaves OTHER projects' state intact", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
        "/p/b": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a", "/p/b"],
    });

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    expect(scheduler.getInFlight().sort()).toEqual(["/p/a", "/p/b"]);

    scheduler.forceClearProject("/p/a");
    expect(scheduler.getInFlight()).toEqual(["/p/b"]);
  });

  it("forceClearAll wipes every project from in-flight + lastFired", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
        "/p/b": { iterativeWork: { enabled: true, cron: "* * * * *" } },
        "/p/c": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a", "/p/b", "/p/c"],
    });

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    expect(scheduler.getInFlight()).toHaveLength(3);

    const result = scheduler.forceClearAll();
    expect(result.inFlightCleared).toBe(3);
    expect(result.lastFiredCleared).toBe(3);
    expect(scheduler.getInFlight()).toEqual([]);
  });

  it("forceClearAll on a fresh scheduler is a no-op", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({}),
      listProjectPaths: () => [],
    });
    expect(scheduler.forceClearAll()).toEqual({ inFlightCleared: 0, lastFiredCleared: 0 });
  });

  it("after forceClearProject, the next tick can re-fire the same project", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    const fires = captureFires(scheduler);

    scheduler.tick(new Date("2026-04-27T05:30:30.000Z"));
    expect(fires).toHaveLength(1);

    scheduler.forceClearProject("/p/a");
    scheduler.tick(new Date("2026-04-27T05:31:30.000Z"));
    expect(fires).toHaveLength(2);
  });
});

describe("IterativeWorkScheduler fire-rate observability (s159 t693)", () => {
  it("getRecentFireCount returns 0 for a project that has never fired", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({}),
      listProjectPaths: () => [],
    });
    expect(scheduler.getRecentFireCount("/p/never")).toBe(0);
  });

  it("getRecentFireCount returns 1 after a normal fire", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    scheduler.tick(new Date("2026-04-27T05:30:00.000Z"));
    expect(scheduler.getRecentFireCount("/p/a", new Date("2026-04-27T05:30:30.000Z"))).toBe(1);
  });

  it("getRecentFireCount drops timestamps older than the 60s window", () => {
    const scheduler = new IterativeWorkScheduler({
      projectConfigManager: makeConfigManager({
        "/p/a": { iterativeWork: { enabled: true, cron: "* * * * *" } },
      }),
      listProjectPaths: () => ["/p/a"],
    });
    scheduler.tick(new Date("2026-04-27T05:00:00.000Z"));
    // 90s later, the recorded fire timestamp is outside the 60s window.
    expect(scheduler.getRecentFireCount("/p/a", new Date("2026-04-27T05:01:30.000Z"))).toBe(0);
  });

  // NOTE: testing the "5 fires in 60s → WARN" runaway path against
  // scheduler.tick directly is tricky because the natural scheduler.tick
  // path is rate-limited by the cron's next-fire-time gate AND lastFiredAt
  // tracking. The runaway scenario reported by owner (Wish #20 / s159)
  // is downstream of scheduler.tick — at the agent-invoker / Taskmaster
  // worker level. This counter is observability for IF the scheduler
  // itself ever loops (defense in depth); the actual reported bug needs
  // tracing in agent-invoker (s159 t693 follow-up) + reproducer (t694).
});
