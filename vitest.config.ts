import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

if (process.env.AIONIMA_TEST_VM !== "1") {
  throw new Error(
    "Tests must run inside the test VM. Use: pnpm test (routes through VM automatically)\n" +
      "If this is CI, set AIONIMA_TEST_VM=1 in the environment.",
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@agi/channel-sdk": resolve("./packages/channel-sdk/src/index.ts"),
      "@agi/entity-model": resolve("./packages/entity-model/src/index.ts"),
      "@agi/coa-chain": resolve("./packages/coa-chain/src/index.ts"),
      "@agi/gateway-core": resolve("./packages/gateway-core/src/index.ts"),
      "@agi/agent-bridge": resolve("./packages/agent-bridge/src/index.ts"),
      "@agi/config": resolve("./config/src/index.ts"),
    },
  },
  test: {
    pool: "forks",
    testTimeout: 15_000,
    include: [
      "packages/**/src/**/*.test.ts",
      "channels/**/src/**/*.test.ts",
      "config/src/**/*.test.ts",
      "cli/src/**/*.test.ts",
      "ui/**/src/**/*.test.ts",
      "apps/**/src/**/*.test.ts",
    ],
    setupFiles: ["test/setup.ts"],
    passWithNoTests: true,
  },
});
