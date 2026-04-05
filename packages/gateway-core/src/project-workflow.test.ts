/**
 * Project Workflow Integration Tests — exercises the full lifecycle
 * against sample project fixtures:
 *   1. detectProjectDefaults() → correct type
 *   2. ProjectConfigManager.create() → config written
 *   3. ProjectConfigManager.updateHosting() → hosting section added
 *   4. ProjectConfigManager.addStack() → stack persisted
 *   5. ProjectConfigManager.readHosting() → reads back correctly
 *   6. ProjectConfigManager.removeStack() → stack removed
 *   7. Change events fire at each mutation step
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readdirSync } from "node:fs";
import { ProjectConfigManager } from "./project-config-manager.js";
import { HostingManager } from "./hosting-manager.js";

const FIXTURES = join(__dirname, "../../../test/fixtures/projects");

// Detect which fixtures are available (works both on host and in VM)
let fixtureNames: string[] = [];
try {
  fixtureNames = readdirSync(FIXTURES).filter((n) => n.startsWith("sample-"));
} catch {
  // Fixtures not available — tests will be skipped
}

const EXPECTED_TYPES: Record<string, string> = {
  "sample-laravel": "web-app",
  "sample-nextjs": "web-app",
  "sample-nuxt": "web-app",
  "sample-react-vite": "web-app",
  "sample-node-api": "api-service",
  "sample-php": "web-app",
  "sample-static": "static-site",
  "sample-python-django": "api-service",
  "sample-vite-only": "static-site",
  "sample-production": "static-site",
};

describe("Project Workflow — sample project integration", () => {
  let tmpDir: string;
  let mgr: ProjectConfigManager;
  let hostingMgr: HostingManager;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, ".agi"), { recursive: true });
    process.env.HOME = tmpDir;

    mgr = new ProjectConfigManager();
    hostingMgr = new HostingManager({
      config: {
        enabled: false,
        lanIp: "127.0.0.1",
        baseDomain: "test.local",
        gatewayPort: 3100,
        portRangeStart: 4000,
        containerRuntime: "podman",
        statusPollIntervalMs: 10_000,
      },
      workspaceProjects: [FIXTURES],
      projectConfigManager: mgr,
    });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  for (const fixture of fixtureNames) {
    const expectedType = EXPECTED_TYPES[fixture] ?? "static-site";

    it(`${fixture}: full workflow (detect → create → host → stack → read → clean)`, async () => {
      const projectPath = join(FIXTURES, fixture);

      // Step 1: Detection
      const detected = hostingMgr.detectProjectDefaults(projectPath);
      expect(detected.projectType).toBe(expectedType);

      // Step 2: Create config via manager
      const events: Array<{ changedKeys: string[] }> = [];
      mgr.on("changed", (e) => events.push(e));

      const config = mgr.create(projectPath, fixture, {
        type: detected.projectType,
      });
      expect(config.name).toBe(fixture);
      expect(config.type).toBe(expectedType);
      expect(events).toHaveLength(1);

      // Step 3: Enable hosting
      await mgr.updateHosting(projectPath, {
        enabled: true,
        type: detected.projectType,
        hostname: fixture,
        docRoot: detected.docRoot,
        startCommand: detected.startCommand,
      });
      const hosting = mgr.readHosting(projectPath);
      expect(hosting).not.toBeNull();
      expect(hosting!.enabled).toBe(true);
      expect(hosting!.type).toBe(expectedType);
      expect(hosting!.hostname).toBe(fixture);

      // Step 4: Add a stack
      if (detected.suggestedStacks.length > 0) {
        await mgr.addStack(projectPath, {
          stackId: detected.suggestedStacks[0]!,
          addedAt: new Date().toISOString(),
        });
        const stacks = mgr.getStacks(projectPath);
        expect(stacks).toHaveLength(1);
        expect(stacks[0]!.stackId).toBe(detected.suggestedStacks[0]);
      }

      // Step 5: Read back full config — everything persisted
      const reread = mgr.read(projectPath);
      expect(reread).not.toBeNull();
      expect(reread!.name).toBe(fixture);
      expect(reread!.hosting?.enabled).toBe(true);

      // Step 6: Remove stack (if added)
      if (detected.suggestedStacks.length > 0) {
        await mgr.removeStack(projectPath, detected.suggestedStacks[0]!);
        expect(mgr.getStacks(projectPath)).toHaveLength(0);
      }

      // Step 7: Verify events fired for each mutation
      // create(1) + updateHosting(1) + addStack(0 or 1) + removeStack(0 or 1) = 2-4 events
      expect(events.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("HostingManager.readHostingMeta delegates to ProjectConfigManager", async () => {
    if (fixtureNames.length === 0) return;
    const projectPath = join(FIXTURES, fixtureNames[0]!);

    mgr.create(projectPath, "delegate-test");
    await mgr.updateHosting(projectPath, {
      enabled: true,
      type: "web-app",
      hostname: "delegate-test",
      docRoot: "dist",
    });

    // Read via HostingManager (should delegate to mgr)
    const meta = hostingMgr.readHostingMeta(projectPath);
    expect(meta).not.toBeNull();
    expect(meta!.enabled).toBe(true);
    expect(meta!.type).toBe("web-app");
    expect(meta!.hostname).toBe("delegate-test");
  });

  it("HostingManager.getProjectStacks delegates to ProjectConfigManager", async () => {
    if (fixtureNames.length === 0) return;
    const projectPath = join(FIXTURES, fixtureNames[0]!);

    mgr.create(projectPath, "stack-delegate-test");
    await mgr.updateHosting(projectPath, {
      enabled: true, type: "web-app", hostname: "stack-test",
    });
    await mgr.addStack(projectPath, { stackId: "stack-test-a", addedAt: "2026-01-01T00:00:00Z" });

    // Read via HostingManager
    const stacks = hostingMgr.getProjectStacks(projectPath);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.stackId).toBe("stack-test-a");
  });
});
