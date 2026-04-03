import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const agiDir = path.join(os.homedir(), ".agi");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  outputDir: path.join(agiDir, "playwright", "test-results"),
  reporter: [["html", { outputFolder: path.join(agiDir, "playwright", "report") }]],
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: [
    {
      command: "bash -lc 'mkdir -p ~/.agi && cat > ~/.agi/onboarding-state.json <<\"EOF\"\n{\n  \"firstbootCompleted\": true,\n  \"steps\": {\n    \"aiKeys\": \"completed\",\n    \"aionimaId\": \"completed\",\n    \"ownerProfile\": \"completed\",\n    \"channels\": \"completed\",\n    \"zeroMeMind\": \"completed\",\n    \"zeroMeSoul\": \"completed\",\n    \"zeroMeSkill\": \"completed\"\n  },\n  \"completedAt\": \"2026-03-07T00:00:00.000Z\"\n}\nEOF\n\npnpm cli --config ./config/e2e.json run'",
      url: "http://localhost:3100/api/system/stats",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm dev:dashboard",
      url: "http://localhost:3001",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
