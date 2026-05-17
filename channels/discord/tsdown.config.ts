import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  outDir: "dist",
  dts: false,
  external: ["discord.js", "@agi/plugins", "@agi/sdk"],
  noExternal: [],
});
