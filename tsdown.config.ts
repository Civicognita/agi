import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["packages/gateway-core/src/index.ts"],
    outDir: "packages/gateway-core/dist",
    format: "esm",
    dts: true,
    clean: true,
    external: ["better-sqlite3", "node-pty", "@agi/security", "pg", "@node-rs/argon2"],
  },
  {
    entry: ["cli/src/index.ts"],
    outDir: "cli/dist",
    format: "esm",
    dts: true,
    clean: true,
    external: ["better-sqlite3", "node-pty", "@node-rs/argon2"],
  },
  {
    entry: ["packages/model-runtime/src/index.ts"],
    outDir: "packages/model-runtime/dist",
    format: "esm",
    dts: true,
    clean: true,
    external: ["pg"],
  },
  {
    entry: ["packages/plugins/src/index.ts"],
    outDir: "packages/plugins/dist",
    format: "esm",
    dts: false,
    clean: true,
    external: ["@agi/gateway-core", "@agi/security", "better-sqlite3", "node-pty", "pg", "@node-rs/argon2"],
  },
  {
    entry: ["packages/aion-sdk/src/index.ts"],
    outDir: "packages/aion-sdk/dist",
    format: "esm",
    dts: false,
    clean: true,
    external: ["@agi/plugins", "@agi/gateway-core", "@agi/security"],
  },
]);
