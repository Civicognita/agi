/**
 * Project Detection Tests — validates detectProjectDefaults() against
 * sample project fixtures from test/fixtures/projects/.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { HostingManager } from "./hosting-manager.js";

const FIXTURES = join(__dirname, "../../../test/fixtures/projects");

// Create a minimal HostingManager just for detection (no infra needed)
const manager = new HostingManager({
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
});

const cases: Array<[string, { projectType: string; suggestedStacks: string[] }]> = [
  ["sample-laravel", { projectType: "web-app", suggestedStacks: ["stack-laravel"] }],
  ["sample-nextjs", { projectType: "web-app", suggestedStacks: ["stack-nextjs"] }],
  ["sample-nuxt", { projectType: "web-app", suggestedStacks: ["stack-nuxt"] }],
  ["sample-react-vite", { projectType: "web-app", suggestedStacks: ["stack-react-vite"] }],
  ["sample-node-api", { projectType: "api-service", suggestedStacks: ["stack-node-app"] }],
  ["sample-php", { projectType: "web-app", suggestedStacks: ["stack-php-app"] }],
  ["sample-static", { projectType: "static-site", suggestedStacks: ["stack-static-hosting"] }],
  ["sample-python-django", { projectType: "web-app", suggestedStacks: ["stack-django"] }],
  ["sample-python-flask", { projectType: "web-app", suggestedStacks: ["stack-flask"] }],
  ["sample-python-fastapi", { projectType: "api-service", suggestedStacks: ["stack-fastapi"] }],
  ["sample-go", { projectType: "api-service", suggestedStacks: ["stack-go-app"] }],
  ["sample-rust", { projectType: "api-service", suggestedStacks: ["stack-rust-app"] }],
  ["sample-vite-only", { projectType: "static-site", suggestedStacks: ["stack-static-hosting"] }],
  ["sample-literature", { projectType: "writing", suggestedStacks: ["stack-literature-reader"] }],
  ["sample-media", { projectType: "art", suggestedStacks: ["stack-media-gallery"] }],
  ["sample-production", { projectType: "static-site", suggestedStacks: ["stack-static-hosting"] }],
];

describe("detectProjectDefaults", () => {
  for (const [fixture, expected] of cases) {
    it(`detects ${fixture} as ${expected.projectType}`, () => {
      const result = manager.detectProjectDefaults(join(FIXTURES, fixture));
      expect(result.projectType).toBe(expected.projectType);
      expect(result.suggestedStacks).toEqual(expected.suggestedStacks);
    });
  }
});
