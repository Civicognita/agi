/**
 * startup-smoke — pre-listen-hook route registration smoke test (s101 t407).
 *
 * Born from the v0.4.187 → v0.4.188 hotfix: a new endpoint registered
 * `GET /api/providers` while server-runtime-state.ts:3788 already had it.
 * Fastify rejected the duplicate at startup, gateway crashed, Caddy returned
 * 502 to every dashboard request — and the unit tests (21/21 in providers-api.
 * test.ts) PASSED because each fixture spun up a fresh Fastify instance.
 *
 * This smoke catches the same class by registering ALL pre-listen-hook
 * `register*Routes` functions into a SINGLE Fastify instance — the same way
 * server.ts does at boot. Any (METHOD, PATH) collision across files trips
 * Fastify's "Method already declared for route" error and fails this test.
 *
 * Coverage:
 *   ✓ Static route collisions across pre-listen-hook files (the v0.4.188 class)
 *   ✓ Dynamic route conflicts that the static lint can't see (e.g. /foo/:id
 *     vs /foo/bar within the same file)
 *   ✓ Signature-break: a register function gaining a required param without
 *     updating callers
 *
 * Out of scope (caught elsewhere):
 *   - Inline routes registered inside server-runtime-state.ts startup function:
 *     covered by `pnpm route-check` static lint (v0.4.189) which scans across
 *     ALL files including server-runtime-state.ts.
 *   - Full startGatewayServer bootstrap (heavy dep mocking): captured as a
 *     follow-up; this register*-only smoke is the cheap-but-high-leverage
 *     v1 of t407.
 */

import { describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

import { registerReportsApi } from "./reports-api.js";
import { registerWorkerApi } from "./worker-api.js";
import { registerComplianceRoutes } from "./compliance-api.js";
import { registerSecurityRoutes } from "./security-api.js";
import { registerUsageRoutes } from "./usage-api.js";
import { registerProvidersRoutes } from "./providers-api.js";
import { registerAdminRoutes } from "./admin-api.js";
import { registerHfRoutes } from "./hf-api.js";
import { registerLemonadeRoutes } from "./lemonade-api.js";

/**
 * Minimal-cost stubs. The register functions only need their deps' shape to
 * match TypeScript at boot — they don't INVOKE most methods during route
 * registration. We use `as never` to bypass type checks; runtime invocations
 * (rare during registration) are covered by individual stub objects below.
 */

function makeNoopLogger(): unknown {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
    child: () => makeNoopLogger(),
  };
}

function makeStubReportsStore(): unknown {
  return {
    list: () => [],
    get: () => null,
    save: vi.fn(),
    delete: vi.fn(),
  };
}

function makeStubWorkerRuntime(): unknown {
  return {
    on: vi.fn(),
    off: vi.fn(),
    listJobs: () => [],
    getJob: () => null,
    cancelJob: vi.fn(),
  };
}

function makeStubCompliance(): unknown {
  const empty = { list: () => [], get: () => null };
  return {
    incidentStore: { ...empty, log: vi.fn() },
    vendorStore: { ...empty, register: vi.fn() },
    sessionStore: { ...empty, log: vi.fn() },
    backupManager: { run: vi.fn(), list: () => [] },
  };
}

function makeStubSecurity(): unknown {
  return {
    scanRunner: { run: vi.fn(), cancel: vi.fn() },
    scanStore: { list: () => [], get: () => null, listFindings: () => [], queryFindings: () => [] },
  };
}

function makeStubUsage(): unknown {
  return {
    usageStore: {
      getByProvider: () => [], getByModel: () => [], getByCostMode: () => [],
      getEscalationRate: () => 0, getSummary: () => ({ totalCostUsd: 0, invocationCount: 0 }),
      getBalanceHistory: () => [],
    },
    getRouterStatus: () => ({ costMode: "balanced", providers: [] }),
  };
}

function makeStubHf(): unknown {
  return {
    hfHubManager: { listInstalled: () => [], listRunning: () => [], install: vi.fn(), remove: vi.fn() },
    hfRuntimeManager: { start: vi.fn(), stop: vi.fn(), listRunning: () => [] },
    hardwareScanner: { scan: () => ({ devices: [], capabilities: [] }) },
    logger: makeNoopLogger(),
  };
}

function makeStubLemonade(): unknown {
  return {
    getConfig: () => ({}),
    logger: makeNoopLogger(),
  };
}

/**
 * Register every pre-listen-hook function into one Fastify instance — the
 * same sequence as server.ts:2138 preListenHooks array.
 */
async function bootRoutes(app: FastifyInstance): Promise<void> {
  registerReportsApi(app, makeStubReportsStore() as never);
  registerWorkerApi(app, makeStubWorkerRuntime() as never);
  registerComplianceRoutes(app, makeStubCompliance() as never);
  registerSecurityRoutes(app, makeStubSecurity() as never);
  registerUsageRoutes(app, makeStubUsage() as never);
  registerProvidersRoutes(app, {
    readConfig: () => ({} as never),
    patchConfig: undefined,
  });
  registerAdminRoutes(app, makeNoopLogger() as never, undefined);
  registerHfRoutes(app, makeStubHf() as never);
  registerLemonadeRoutes(app, makeStubLemonade() as never);

  // Fastify defers route validation until the routes are flushed; ready()
  // forces the validation now so a collision throws in the test, not at
  // production boot time.
  await app.ready();
}

describe("startup-smoke — pre-listen-hook route registration (s101 t407)", () => {
  it("registers every pre-listen-hook into one Fastify without collision", async () => {
    const app = Fastify({ logger: false });
    await expect(bootRoutes(app)).resolves.toBeUndefined();
    await app.close();
  });

  it("registers a meaningful number of routes (catches register-function silent-failures)", async () => {
    const app = Fastify({ logger: false });
    await bootRoutes(app);

    // Count registered routes via the printRoutes() output. If any register
    // function silently no-op'd (e.g. its deps stub broke a guard), the
    // total drops noticeably.
    const tree = app.printRoutes();
    const routeLines = tree.split("\n").filter((l) => l.includes("(") && /\b(GET|POST|PUT|DELETE|PATCH|HEAD)\b/.test(l));
    // Conservative floor — we expect at least 30 routes across the 9
    // register* functions. If this drops, a register function is likely
    // failing silently and only registering a subset.
    expect(routeLines.length).toBeGreaterThanOrEqual(30);

    await app.close();
  });

  it("simulating the v0.4.187 collision detects it (negative test)", async () => {
    const app = Fastify({ logger: false });
    // First registration succeeds. Second attempt to register the same
    // (METHOD, PATH) must throw — proving the smoke is doing what it claims.
    app.get("/api/providers/catalog", async () => ({ ok: true }));
    expect(() => app.get("/api/providers/catalog", async () => ({ ok: true })))
      .toThrow(/already declared/i);
    await app.close();
  });
});
