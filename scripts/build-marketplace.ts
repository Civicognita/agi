/**
 * build-marketplace.ts — Compile marketplace plugins into self-contained ESM bundles.
 *
 * Each plugin's src/index.ts is bundled with esbuild, inlining @agi/*
 * workspace imports so plugins don't need node_modules/@agi/* at runtime.
 *
 * Usage:
 *   tsx scripts/build-marketplace.ts [MARKETPLACE_DIR]
 *
 * Defaults:
 *   MARKETPLACE_DIR = /opt/agi-marketplace (or AIONIMA_MARKETPLACE_DIR env)
 *   AGI_DIR         = process.cwd() (the AGI repo root)
 */

import { build, type Plugin } from "esbuild";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const AGI_DIR = process.cwd();
const MARKETPLACE_DIR = process.argv[2]
  ?? process.env.AIONIMA_MARKETPLACE_DIR
  ?? "/opt/agi-marketplace";

const PLUGINS_DIR = join(MARKETPLACE_DIR, "plugins");

// Flat-cache mode: build an INSTALLED plugin cache in place (each immediate
// subdir is a plugin: <dir>/<id>/src/index.ts → <dir>/<id>/dist/index.js). The
// marketplace ships SOURCE (dist/ is gitignored); prod builds plugins via the
// upgrade pipeline, but the test-VM provisioning installs to the cache without
// building, leaving an empty dist/ so the loader falls back to src/index.ts and
// the workspace-only `@agi/sdk` import fails to resolve. Point this at
// ~/.agi/plugins/cache to mirror the prod build. Must run with cwd = the AGI repo
// so the @agi/* alias map resolves to the workspace source.
const PLUGIN_CACHE_DIR = process.env.AIONIMA_PLUGIN_CACHE_DIR;

// Native modules can't be bundled but ESM import won't resolve them from
// the plugin cache. Rewrite to require() which uses the banner's createRequire.
// @node-rs/argon2 ships .node binaries (reached transitively via @agi/security
// when a plugin's import graph touches @agi/gateway-core); esbuild has no loader
// for .node, so it must be require()'d at runtime, not bundled.
const NATIVE_EXTERNALS = new Set(["better-sqlite3", "node-pty", "@node-rs/argon2"]);
const nativeRequirePlugin: Plugin = {
  name: "native-require",
  setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (NATIVE_EXTERNALS.has(args.path)) {
        return { path: args.path, namespace: "native-require" };
      }
    });
    b.onLoad({ filter: /.*/, namespace: "native-require" }, args => ({
      // CJS (module.exports) not `export default` so esbuild's CJS interop also
      // satisfies NAMED imports, e.g. `import { hash, verify } from "@node-rs/argon2"`
      // in gateway-core's auth-backends. `export default` only covers default imports.
      contents: `module.exports = require(${JSON.stringify(args.path)});`,
      loader: "js",
    }));
  },
};

// Map @agi/* imports to AGI workspace source so esbuild can bundle them
const ALIASES: Record<string, string> = {
  "@agi/sdk": resolve(AGI_DIR, "packages/aion-sdk/src/index.ts"),
  "@agi/plugins": resolve(AGI_DIR, "packages/plugins/src/index.ts"),
  "@agi/channel-sdk": resolve(AGI_DIR, "packages/channel-sdk/src/index.ts"),
  "@agi/gateway-core": resolve(AGI_DIR, "packages/gateway-core/src/index.ts"),
  "@agi/config": resolve(AGI_DIR, "config/src/index.ts"),
};

async function buildPlugin(pluginDir: string, name: string): Promise<boolean> {
  const entry = join(pluginDir, "src/index.ts");
  if (!existsSync(entry)) {
    console.log(`  skip ${name} — no src/index.ts`);
    return false;
  }

  const outfile = join(pluginDir, "dist/index.js");

  try {
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      banner: {
        js: `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(AGI_DIR + "/package.json")});`,
      },
      plugins: [nativeRequirePlugin],
      external: [
        "node:*",
        "grammy",
        "discord.js",
        "googleapis",
        // playwright-core does dynamic require()s of chromium-bidi that esbuild
        // can't statically resolve. It's reached transitively via @agi/gateway-core
        // for most plugins (dead code there) and used directly by browser plugins
        // (plugin-chrome-devtools-mcp). Leave it external — resolved at runtime via
        // the banner's createRequire when actually invoked.
        "playwright-core",
        "playwright",
        "chromium-bidi",
        "chromium-bidi/*",
      ],
      alias: ALIASES,
      logLevel: "warning",
    });
    console.log(`  built ${name} → dist/index.js`);
    return true;
  } catch (err) {
    console.error(`  FAIL ${name}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Build an installed plugin cache in place (flat: <dir>/<id>/src/index.ts). */
async function buildCacheDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    console.log(`Plugin cache dir not found: ${dir}`);
    return;
  }
  const plugins = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "src/index.ts")))
    .map((e) => ({ name: e.name, path: join(dir, e.name) }));

  console.log(`Building ${plugins.length} cache plugins in ${dir}...`);
  let built = 0, skipped = 0, failed = 0;
  for (const { name, path } of plugins) {
    const dist = join(path, "dist/index.js");
    if (existsSync(dist) && statSync(dist).size > 0) { skipped++; continue; }
    const ok = await buildPlugin(path, name);
    if (ok) built++; else failed++;
  }
  // Don't hard-fail provisioning on a partial build — log and continue.
  console.log(`\nDone: ${built} built, ${skipped} already-built, ${failed} failed`);
}

async function main(): Promise<void> {
  if (PLUGIN_CACHE_DIR) {
    await buildCacheDir(PLUGIN_CACHE_DIR);
    return;
  }
  if (!existsSync(PLUGINS_DIR)) {
    console.log(`Marketplace plugins dir not found: ${PLUGINS_DIR}`);
    process.exit(0);
  }

  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const pluginDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("plugin-"))
    .map((e) => ({ name: e.name, path: join(PLUGINS_DIR, e.name) }));

  if (pluginDirs.length === 0) {
    console.log("No marketplace plugins found.");
    return;
  }

  console.log(`Building ${pluginDirs.length} marketplace plugins...`);

  let built = 0;
  let failed = 0;

  for (const { name, path } of pluginDirs) {
    const ok = await buildPlugin(path, name);
    if (ok) built++;
    else failed++;
  }

  console.log(`\nDone: ${built} built, ${failed} skipped/failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("build-marketplace failed:", err);
  process.exit(1);
});
