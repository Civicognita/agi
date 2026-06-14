/**
 * Boot Recovery — graceful-shutdown marker + crash detection.
 *
 * On graceful shutdown (SIGTERM/SIGINT), gateway writes a snapshot of what was
 * running (project containers, HF model containers, external deps) to
 * ~/.agi/shutdown-state.json. On next boot, presence of that marker means the
 * previous exit was graceful — we reconcile (start any deps that drifted) and
 * continue normal boot. Absence means a crash — we enter safemode.
 *
 * Invariants:
 *   - Marker is written FIRST during close(), before any subsystem stops.
 *   - Marker is deleted ONLY after successful reconciliation on boot.
 *   - Reconcilers never throw — failures are logged and boot continues.
 *   - No manual podman/systemctl required of the user, ever.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createConnection } from "node:net";
import type { ComponentLogger } from "./logger.js";
type Log = ComponentLogger;

// ---------------------------------------------------------------------------
// Marker types
// ---------------------------------------------------------------------------

export interface ShutdownMarker {
  version: 1;
  shutdownAt: string;
  reason: "sigterm" | "sigint" | "restart" | "upgrade";
  pid: number;
  externals: {
    /** Podman container name for the ID service's Postgres instance. */
    idPostgresContainer: string;
    /** @deprecated Absorbed into gateway — no longer a separate service. */
    idService?: string;
  };
  projects: RunningProjectSnapshot[];
  models: RunningModelSnapshot[];
}

export interface RunningProjectSnapshot {
  slug: string;
  containerName: string;
}

export interface RunningModelSnapshot {
  modelId: string;
  containerName: string;
}

// ---------------------------------------------------------------------------
// Marker path
// ---------------------------------------------------------------------------

export const DEFAULT_MARKER_PATH = join(homedir(), ".agi", "shutdown-state.json");

// ---------------------------------------------------------------------------
// External-dep defaults
// ---------------------------------------------------------------------------

// PostgreSQL runs as a rootless Podman container on the shared `aionima`
// network. We don't rely on a hardcoded container name — we probe the port
// and, if not responding, discover any stopped postgres container by image.
export const ID_POSTGRES_CONTAINER = "agi-postgres-17";
export const ID_POSTGRES_PORT = 5432;

// ---------------------------------------------------------------------------
// Read / write / delete marker
// ---------------------------------------------------------------------------

/**
 * Read the marker if it exists, delete it, and return the parsed contents.
 * Returns null if no marker (→ crash detected) or parse failed.
 */
export function readAndConsumeShutdownMarker(
  markerPath: string = DEFAULT_MARKER_PATH,
): ShutdownMarker | null {
  if (!existsSync(markerPath)) return null;
  let parsed: ShutdownMarker | null = null;
  try {
    const raw = readFileSync(markerPath, "utf8");
    const obj = JSON.parse(raw) as ShutdownMarker;
    if (obj.version === 1) parsed = obj;
  } catch {
    parsed = null;
  }
  // Delete even on parse failure — a corrupt marker means we can't trust it,
  // and leaving it would mask a real crash on the NEXT boot.
  try {
    unlinkSync(markerPath);
  } catch {
    /* best effort */
  }
  return parsed;
}

/**
 * Peek at the marker without consuming it. Used by diagnostics and the
 * safemode investigator (which wants to know if the LAST shutdown was
 * graceful, even though the current boot is a crash).
 */
export function peekShutdownMarker(
  markerPath: string = DEFAULT_MARKER_PATH,
): ShutdownMarker | null {
  if (!existsSync(markerPath)) return null;
  try {
    const raw = readFileSync(markerPath, "utf8");
    const obj = JSON.parse(raw) as ShutdownMarker;
    return obj.version === 1 ? obj : null;
  } catch {
    return null;
  }
}

export function writeShutdownMarker(
  marker: ShutdownMarker,
  markerPath: string = DEFAULT_MARKER_PATH,
): void {
  writeFileSync(markerPath, JSON.stringify(marker, null, 2), "utf8");
}

/** Build a marker from current running state. */
export function buildShutdownMarker(
  projects: RunningProjectSnapshot[],
  models: RunningModelSnapshot[],
  reason: ShutdownMarker["reason"] = "sigterm",
): ShutdownMarker {
  return {
    version: 1,
    shutdownAt: new Date().toISOString(),
    reason,
    pid: process.pid,
    externals: {
      idPostgresContainer: ID_POSTGRES_CONTAINER,
    },
    projects,
    models,
  };
}

// ---------------------------------------------------------------------------
// Podman / systemd helpers
// ---------------------------------------------------------------------------

function podmanContainerState(name: string): "running" | "exited" | "created" | "missing" {
  try {
    const out = execFileSync("podman", [
      "inspect", name,
      "--format", "{{.State.Status}}",
    ], { stdio: "pipe", timeout: 8_000 }).toString().trim();
    if (out === "running") return "running";
    if (out === "exited") return "exited";
    if (out === "created") return "created";
    return "missing";
  } catch {
    return "missing";
  }
}

function podmanStart(name: string, log: Log): boolean {
  try {
    execFileSync("podman", ["start", name], { stdio: "pipe", timeout: 20_000 });
    return true;
  } catch (err) {
    log.warn(`[boot-recovery] podman start ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}


async function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function waitForPort(
  host: string,
  port: number,
  timeoutMs: number,
  log: Log,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    if (await probeTcp(host, port, 1_000)) {
      if (attempt > 1) log.info(`[boot-recovery] ${host}:${String(port)} ready after ${String(attempt)} attempt(s)`);
      return true;
    }
    await sleep(1_000);
  }
  log.warn(`[boot-recovery] ${host}:${String(port)} did not come up within ${String(timeoutMs)}ms`);
  return false;
}

// ---------------------------------------------------------------------------
// Reconcilers — each returns a report. None throw.
// ---------------------------------------------------------------------------

export interface ReconcileReport {
  externals: {
    postgres: { action: "none" | "started" | "failed"; state: string };
    postgresReady: boolean;
  };
  projects: { total: number; started: number; failed: number; skipped: number };
  models: { total: number; started: number; failed: number; skipped: number };
}

/**
 * Ensure critical externals are running. Safe to call unconditionally on every
 * boot — AGI's model/dataset DBs live in the ID-service Postgres, so we always
 * need it up. In safemode we skip project/model restoration but still ensure
 * externals so the gateway itself can initialize.
 */
export async function ensureExternals(
  log: Log,
): Promise<ReconcileReport["externals"]> {
  return reconcileExternalsPostgres(log);
}

export async function reconcileExternals(
  _marker: ShutdownMarker,
  log: Log,
): Promise<ReconcileReport["externals"]> {
  return reconcileExternalsPostgres(log);
}

async function reconcileExternalsPostgres(
  log: Log,
): Promise<ReconcileReport["externals"]> {

  // ---- Postgres — check by port, not by container name ----
  // PostgreSQL is now managed by the agi-postgres plugin (shared container
  // system). We don't assume a specific container name; instead we probe
  // port 5432. If it's not up, we look for any stopped postgres container
  // (by image ancestor) and try to start it.
  let pgAction: "none" | "started" | "failed" = "none";
  let pgState = "unknown";

  const pgAlreadyUp = await probeTcp("127.0.0.1", ID_POSTGRES_PORT, 2_000);
  if (pgAlreadyUp) {
    pgState = "running";
    pgAction = "none";
  } else {
    // Discover any postgres container that is not running and try to start it
    try {
      const stoppedNames = execFileSync(
        "podman",
        ["ps", "-a", "--filter", "ancestor=ghcr.io/civicognita/postgres:17",
          "--filter", "status=exited", "--filter", "status=created",
          "--format", "{{.Names}}"],
        { stdio: "pipe", timeout: 8_000 },
      ).toString().trim();

      if (stoppedNames.length > 0) {
        const firstName = stoppedNames.split("\n")[0]!.trim();
        pgState = "exited";
        log.info(`[boot-recovery] postgres container ${firstName} is stopped — starting`);
        pgAction = podmanStart(firstName, log) ? "started" : "failed";
      } else {
        pgState = "missing";
        log.warn("[boot-recovery] no postgres container found and port 5432 not open — skipping");
        pgAction = "failed";
      }
    } catch {
      pgState = "missing";
      log.warn("[boot-recovery] failed to discover postgres containers — skipping");
      pgAction = "failed";
    }
  }

  // ---- Wait for Postgres to accept connections ----
  const pgReady = pgAlreadyUp || await waitForPort("127.0.0.1", ID_POSTGRES_PORT, 15_000, log);

  return {
    postgres: { action: pgAction, state: pgState },
    postgresReady: pgReady,
  };
}

export function reconcileProjects(
  projects: RunningProjectSnapshot[],
  log: Log,
): ReconcileReport["projects"] {
  let started = 0, failed = 0, skipped = 0;
  for (const p of projects) {
    const state = podmanContainerState(p.containerName);
    if (state === "running") {
      skipped += 1;
      continue;
    }
    if (state === "missing") {
      log.warn(`[boot-recovery] project container ${p.containerName} missing — skipping`);
      failed += 1;
      continue;
    }
    if (podmanStart(p.containerName, log)) {
      log.info(`[boot-recovery] restarted project container ${p.containerName} (${p.slug})`);
      started += 1;
    } else {
      failed += 1;
    }
  }
  return { total: projects.length, started, failed, skipped };
}

export function reconcileModels(
  models: RunningModelSnapshot[],
  log: Log,
): ReconcileReport["models"] {
  let started = 0, failed = 0, skipped = 0;
  for (const m of models) {
    const state = podmanContainerState(m.containerName);
    if (state === "running") {
      skipped += 1;
      continue;
    }
    if (state === "missing") {
      log.warn(`[boot-recovery] model container ${m.containerName} missing — skipping`);
      failed += 1;
      continue;
    }
    if (podmanStart(m.containerName, log)) {
      log.info(`[boot-recovery] restarted model container ${m.containerName} (${m.modelId})`);
      started += 1;
    } else {
      failed += 1;
    }
  }
  return { total: models.length, started, failed, skipped };
}

/**
 * Run full reconciliation from a marker. Always runs in this order:
 * externals first (DB must be up before anything else), then projects and
 * models in parallel. Returns a structured report.
 */
export async function reconcileFromMarker(
  marker: ShutdownMarker,
  log: Log,
): Promise<ReconcileReport> {
  const externals = await reconcileExternals(marker, log);
  const projects = reconcileProjects(marker.projects, log);
  const models = reconcileModels(marker.models, log);
  return { externals, projects, models };
}

// ---------------------------------------------------------------------------
// Recover-all — used when no marker exists (post-crash). Discovers managed
// containers from labels + the model-containers.json heartbeat file and starts
// everything that isn't currently running.
// ---------------------------------------------------------------------------

export interface RecoveryResult {
  externals: ReconcileReport["externals"];
  projects: { total: number; started: number; failed: number };
  models: { total: number; started: number; failed: number };
}

function discoverManagedProjectContainers(log: Log): string[] {
  try {
    const out = execFileSync(
      "podman",
      [
        "ps", "-a",
        "--filter", "label=agi.managed=true",
        "--format", "{{.Names}}",
      ],
      { stdio: "pipe", timeout: 10_000 },
    ).toString().trim();
    if (out.length === 0) return [];
    return out.split("\n").filter((n) => n.length > 0);
  } catch (err) {
    log.warn(`[boot-recovery] discover managed containers failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function readModelContainersHeartbeat(log: Log): string[] {
  const heartbeatPath = join(homedir(), ".agi", "model-containers.json");
  if (!existsSync(heartbeatPath)) return [];
  try {
    const raw = readFileSync(heartbeatPath, "utf8");
    const parsed = JSON.parse(raw) as { containers?: Array<{ containerName?: string }> };
    if (!Array.isArray(parsed.containers)) return [];
    return parsed.containers
      .map((c) => c.containerName)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
  } catch (err) {
    log.warn(`[boot-recovery] read model-containers.json failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Recover everything after a crash: ensure externals, then find and start any
 * managed containers that are in Created/Exited state. Used by the
 * `POST /api/admin/safemode/exit` endpoint and by `agi safemode exit`.
 */
export async function recoverAllManagedContainers(log: Log): Promise<RecoveryResult> {
  const externals = await ensureExternals(log);

  const projectNames = discoverManagedProjectContainers(log);
  const projectResults = { total: projectNames.length, started: 0, failed: 0 };
  for (const name of projectNames) {
    const state = podmanContainerState(name);
    if (state === "running") continue;
    if (state === "missing") continue;
    if (podmanStart(name, log)) {
      log.info(`[boot-recovery] recovered project container ${name}`);
      projectResults.started += 1;
    } else {
      projectResults.failed += 1;
    }
  }

  const modelNames = readModelContainersHeartbeat(log);
  const modelResults = { total: modelNames.length, started: 0, failed: 0 };
  for (const name of modelNames) {
    const state = podmanContainerState(name);
    if (state === "running") continue;
    if (state === "missing") continue;
    if (podmanStart(name, log)) {
      log.info(`[boot-recovery] recovered model container ${name}`);
      modelResults.started += 1;
    } else {
      modelResults.failed += 1;
    }
  }

  return { externals, projects: projectResults, models: modelResults };
}
