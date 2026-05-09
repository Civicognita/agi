/**
 * Container diagnostic — normalizePodmanEntry + classifyContainer (s144 t576).
 * Pure logic; runs on host.
 */

import { describe, it, expect } from "vitest";
import { normalizePodmanEntry, classifyContainer, type ContainerSummary } from "./doctor.js";

describe("normalizePodmanEntry (s144 t576)", () => {
  it("parses canonical podman 4.x shape", () => {
    const entry = {
      Names: ["agi-postgres"],
      State: "running",
      Status: "Up 2 hours",
      ExitCode: 0,
      RestartCount: 0,
      StartedAt: "2026-05-09T01:00:00Z",
    };
    expect(normalizePodmanEntry(entry)).toEqual({
      name: "agi-postgres",
      status: "Up 2 hours",
      state: "running",
      exitCode: 0,
      restartCount: 0,
      startedAt: "2026-05-09T01:00:00Z",
    });
  });

  it("accepts lowercased keys (older podman versions)", () => {
    const entry = {
      names: "agi-caddy",
      state: "exited",
      status: "Exited (1) 5m ago",
      exitcode: 1,
      restartcount: 5,
      startedat: "2026-05-09T00:00:00Z",
    };
    const r = normalizePodmanEntry(entry);
    expect(r.name).toBe("agi-caddy");
    expect(r.exitCode).toBe(1);
    expect(r.restartCount).toBe(5);
  });

  it("falls back to safe defaults on missing fields", () => {
    const r = normalizePodmanEntry({});
    expect(r).toEqual({
      name: "(unknown)",
      status: "",
      state: "",
      exitCode: 0,
      restartCount: 0,
      startedAt: "",
    });
  });

  it("coerces string-shaped numeric fields", () => {
    const entry = { Names: ["x"], ExitCode: "137", RestartCount: "12" };
    const r = normalizePodmanEntry(entry);
    expect(r.exitCode).toBe(137);
    expect(r.restartCount).toBe(12);
  });
});

describe("classifyContainer (s144 t576)", () => {
  const base: ContainerSummary = {
    name: "agi-x",
    status: "Up 1h",
    state: "running",
    exitCode: 0,
    restartCount: 0,
    startedAt: "2026-05-09T00:00:00Z",
  };

  it("running + clean restarts → ok", () => {
    expect(classifyContainer(base)).toEqual({ ok: true, warn: false, reason: "running" });
  });

  it("stopped with non-zero exit → failing (not warn)", () => {
    const c = { ...base, state: "exited", status: "Exited (137) 3m ago", exitCode: 137 };
    const r = classifyContainer(c);
    expect(r.ok).toBe(false);
    expect(r.warn).toBe(false);
    expect(r.reason).toContain("exit 137");
  });

  it("stopped with exit 0 → ok (intentional shutdown)", () => {
    const c = { ...base, state: "exited", status: "Exited (0) 10m ago", exitCode: 0 };
    expect(classifyContainer(c).ok).toBe(true);
  });

  it("running but restart count > 3 → warn (flapping)", () => {
    const c = { ...base, restartCount: 5 };
    const r = classifyContainer(c);
    expect(r.ok).toBe(false);
    expect(r.warn).toBe(true);
    expect(r.reason).toContain("flapping");
    expect(r.reason).toContain("5 restarts");
  });

  it("running with restartCount === 3 → still ok (boundary)", () => {
    expect(classifyContainer({ ...base, restartCount: 3 }).ok).toBe(true);
  });

  it("treats Status='Up …' as running even when state field is missing", () => {
    const c = { ...base, state: "", status: "Up 5 minutes" };
    expect(classifyContainer(c).ok).toBe(true);
  });

  it("running + non-zero exitCode counted historical → still warn-by-flapping if restarts >3", () => {
    // Containers can be "running" again after a non-zero exit was recorded
    // before the restart. We don't penalize the historical exit if the
    // container is back up with low restart count.
    const c = { ...base, exitCode: 1, restartCount: 1 };
    expect(classifyContainer(c).ok).toBe(true);
  });
});
