import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["packages/gateway-core/src/index.ts"],
    outDir: "packages/gateway-core/dist",
    format: "esm",
    dts: true,
    clean: true,
    external: ["better-sqlite3", "node-pty"],
  },
  {
    entry: ["cli/src/index.ts"],
    outDir: "cli/dist",
    format: "esm",
    dts: true,
    clean: true,
    external: ["better-sqlite3", "node-pty"],
  },
]);
