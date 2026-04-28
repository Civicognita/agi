/**
 * Installer — install marketplace plugins from various source types.
 *
 * Supports: GitHub repos, npm packages, git URLs.
 * Matches Claude Code's plugin installation model.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { PluginSource, MarketplaceItemType } from "./types.js";

// --- sudo helpers (passwordless sudo is configured for the service user) ---

function sudoMkdir(path: string): void {
  execSync(`sudo mkdir -p ${shellEscape(path)}`, { stdio: "pipe" });
}

function sudoRm(path: string): void {
  execSync(`sudo rm -rf ${shellEscape(path)}`, { stdio: "pipe" });
}

/** Copy contents of src INTO dest (not src itself). */
function sudoCpContents(src: string, dest: string): void {
  execSync(`sudo cp -a ${shellEscape(src + "/.")} ${shellEscape(dest)}`, { stdio: "pipe" });
}

function sudoWriteFile(path: string, content: string): void {
  execSync(`sudo tee ${shellEscape(path)} > /dev/null`, {
    input: content,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export interface InstallContext {
  workspaceRoot: string;
  /** Cache directory for cloned/downloaded plugins. Defaults to .plugins/cache. */
  cacheDir?: string;
  /** Marketplace source reference (e.g. "Civicognita/agi-marketplace") for resolving relative-path sources. */
  sourceRef?: string;
}

/** Determine the installation target path for an item by type. */
export function getInstallPath(name: string, itemType: MarketplaceItemType, ctx: InstallContext): string {
  const cacheDir = ctx.cacheDir ?? join(ctx.workspaceRoot, ".plugins", "cache");
  switch (itemType) {
    case "plugin":
      return join(cacheDir, name);
    case "skill":
      return join(ctx.workspaceRoot, "skills", `${name}.skill.md`);
    case "knowledge":
      return join(ctx.workspaceRoot, ".agi", "marketplace-knowledge", name);
    case "theme":
      return join(cacheDir, `theme-${name}`);
    case "workflow":
      return join(ctx.workspaceRoot, ".agi", "workflows", `${name}.workflow.json`);
    case "channel":
      return join(ctx.workspaceRoot, "channels", name);
    case "agent-tool":
      return join(cacheDir, `tool-${name}`);
    default:
      return join(cacheDir, name);
  }
}

/**
 * Compute a deterministic SHA-256 integrity hash over all .ts, .js, and .json
 * files found (recursively) under installPath.
 */
export function computePluginIntegrityHash(installPath: string): string {
  const hash = createHash("sha256");

  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(installPath, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[];
  } catch {
    return hash.digest("hex");
  }

  const files = entries
    .filter(e => e.isFile() && /\.(ts|js|json)$/.test(e.name))
    .map(e => {
      const dir = (e as unknown as { parentPath?: string; path?: string }).parentPath
        ?? (e as unknown as { path?: string }).path
        ?? installPath;
      return join(dir, e.name);
    })
    .sort();

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath);
      hash.update(content);
    } catch {
      // Skip unreadable files
    }
  }

  return hash.digest("hex");
}

export interface InstallResult {
  installPath: string;
  integrityHash: string;
}

/** Install a plugin from its source. Returns the install path and integrity hash. */
export async function installPlugin(
  name: string,
  source: PluginSource,
  itemType: MarketplaceItemType,
  ctx: InstallContext,
): Promise<InstallResult> {
  const installPath = getInstallPath(name, itemType, ctx);

  if (typeof source === "string") {
    if (!ctx.sourceRef) {
      throw new Error(`Cannot install "${name}": relative-path source requires a marketplace reference`);
    }
    await installFromMarketplaceSubdir(source, ctx.sourceRef, installPath);
  } else

  switch (source.source) {
    case "github":
      await installFromGitHub(source.repo, installPath, source.ref, source.sha);
      break;
    case "url":
      await installFromGitUrl(source.url, installPath, source.ref);
      break;
    case "npm":
      await installFromNpm(source.package, installPath, source.version, source.registry);
      break;
    case "pip":
      throw new Error(`pip source not yet supported for Aionima plugins`);
    default:
      throw new Error(`Unknown source type for plugin "${name}"`);
  }

  // Write marketplace metadata
  const metaPath = join(installPath, ".marketplace-meta.json");
  if (existsSync(installPath) && !installPath.endsWith(".md") && !installPath.endsWith(".json")) {
    sudoWriteFile(metaPath, JSON.stringify({
      name,
      type: itemType,
      source,
      installedAt: new Date().toISOString(),
    }, null, 2));
  }

  // Compute integrity hash over installed source files
  const integrityHash = existsSync(installPath) && !installPath.endsWith(".md") && !installPath.endsWith(".json")
    ? computePluginIntegrityHash(installPath)
    : "";

  return { installPath, integrityHash };
}

/**
 * Install a plugin from a marketplace subdirectory.
 * Clones the full marketplace repo to a temp dir, copies the subdirectory to installPath.
 */
async function installFromMarketplaceSubdir(relativePath: string, sourceRef: string, installPath: string): Promise<void> {
  // Extract owner/repo and optional branch from sourceRef
  // Supports: "owner/repo", "owner/repo#branch", full GitHub URLs
  const repoMatch = sourceRef.match(/(?:github\.com\/)?([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
  const repo = repoMatch?.[1];
  if (!repo) {
    throw new Error(`Cannot parse GitHub repo from marketplace source: ${sourceRef}`);
  }
  // Extract branch from #ref suffix (e.g. "owner/repo#dev")
  const branchMatch = sourceRef.match(/#([a-zA-Z0-9_.-]+)$/);
  const branch = branchMatch?.[1] ?? "main";

  // Strip leading ./ from relative path
  const subdir = relativePath.replace(/^\.\//, "");
  const tmpId = randomBytes(6).toString("hex");
  const tmpDir = join("/tmp", `mp-${tmpId}`);

  try {
    execSync(
      `sudo git clone --depth 1 --branch ${shellEscape(branch)} https://github.com/${shellEscape(repo)}.git ${shellEscape(tmpDir)}`,
      { stdio: "pipe", timeout: 120_000 },
    );

    const srcDir = join(tmpDir, subdir);
    if (!existsSync(srcDir)) {
      throw new Error(`Subdirectory "${subdir}" not found in marketplace repo ${repo}`);
    }

    sudoRm(installPath);
    sudoMkdir(installPath);
    sudoCpContents(srcDir, installPath);

    // Remove .git if it got copied
    sudoRm(join(installPath, ".git"));

    await installDependencies(installPath);
    await buildPlugin(installPath);
  } finally {
    sudoRm(tmpDir);
  }
}

async function installFromGitHub(repo: string, installPath: string, ref?: string, sha?: string): Promise<void> {
  sudoRm(installPath);
  sudoMkdir(installPath);

  const cloneRef = sha ?? ref ?? "main";
  try {
    execSync(
      `sudo git clone --depth 1 --branch ${shellEscape(cloneRef)} https://github.com/${shellEscape(repo)}.git ${shellEscape(installPath)}`,
      { stdio: "pipe", timeout: 120_000 },
    );
  } catch {
    // Branch/tag clone failed — try cloning main and checking out the sha
    execSync(
      `sudo git clone --depth 50 https://github.com/${shellEscape(repo)}.git ${shellEscape(installPath)}`,
      { stdio: "pipe", timeout: 120_000 },
    );
    if (sha) {
      execSync(`sudo git -C ${shellEscape(installPath)} checkout ${shellEscape(sha)}`, { stdio: "pipe" });
    }
  }

  // Remove .git directory for security (matches Claude Code behavior)
  sudoRm(join(installPath, ".git"));

  // Install dependencies and build
  await installDependencies(installPath);
  await buildPlugin(installPath);
}

async function installFromGitUrl(url: string, installPath: string, ref?: string): Promise<void> {
  sudoRm(installPath);
  sudoMkdir(installPath);

  const args = ref ? `--branch ${shellEscape(ref)}` : "";
  execSync(
    `sudo git clone --depth 1 ${args} ${shellEscape(url)} ${shellEscape(installPath)}`,
    { stdio: "pipe", timeout: 120_000 },
  );

  sudoRm(join(installPath, ".git"));
  await installDependencies(installPath);
  await buildPlugin(installPath);
}

async function installFromNpm(pkg: string, installPath: string, version?: string, registry?: string): Promise<void> {
  sudoRm(installPath);
  sudoMkdir(installPath);

  const spec = version ? `${pkg}@${version}` : pkg;
  const registryFlag = registry ? `--registry=${shellEscape(registry)}` : "";

  // Use npm pack + extract to get the package without a full node_modules tree
  execSync(
    `sudo npm pack ${shellEscape(spec)} ${registryFlag} --pack-destination=${shellEscape(installPath)}`,
    { stdio: "pipe", timeout: 120_000, cwd: installPath },
  );

  // Find the tarball (read-only, no sudo needed)
  const tgzFiles = readdirSync(installPath).filter((f) => f.endsWith(".tgz"));
  if (tgzFiles[0]) {
    execSync(`sudo tar xzf ${shellEscape(tgzFiles[0])} --strip-components=1`, { cwd: installPath, stdio: "pipe" });
    sudoRm(join(installPath, tgzFiles[0]));
  }

  await installDependencies(installPath);
  await buildPlugin(installPath);
}

async function installDependencies(dir: string): Promise<void> {
  if (!existsSync(join(dir, "package.json"))) return;
  try {
    execSync("sudo npm install --production --no-audit --no-fund", {
      cwd: dir,
      stdio: "pipe",
      timeout: 120_000,
    });
  } catch {
    // Dependencies are optional — plugin may still work
  }
}

/**
 * Build a plugin with esbuild — bundles @agi/* workspace imports inline
 * and injects createRequire so CJS packages (ulid, etc.) work in ESM output.
 * Uses sudo because the plugin cache dirs are root-owned.
 */
async function buildPlugin(dir: string): Promise<void> {
  const entry = join(dir, "src/index.ts");
  if (!existsSync(entry)) return;

  const agiDir = process.cwd();
  const outfile = join(dir, "dist/index.js");

  // Write a temporary build script that esbuild can execute.
  // We use a file instead of inline -e because the alias map is complex.
  const buildScript = join(dir, ".build-plugin.mjs");
  // Point createRequire to the AGI install dir so externalized native
  // modules (better-sqlite3, etc.) resolve from AGI's node_modules.
  const banner = `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(agiDir + "/package.json")});`;

  // Native modules can't be bundled by esbuild but ESM import resolution
  // won't find them from the plugin cache dir. Use a plugin to rewrite
  // them as require() calls — the banner's createRequire points to AGI's
  // install dir where these packages live.
  const nativeExternals = ["better-sqlite3", "node-pty"];

  const scriptContent = `
// Resolve esbuild from AGI's installation, not the plugin dir.
import { createRequire } from "node:module";
const esmRequire = createRequire(${JSON.stringify(agiDir + "/package.json")});
const { build } = esmRequire("esbuild");

// Plugin: rewrite native module imports to use require() from the banner.
// ESM import resolution checks the importing file's location, which won't
// have these packages. require() from createRequire(AGI/package.json) does.
const nativeRequirePlugin = {
  name: "native-require",
  setup(b) {
    const natives = new Set(${JSON.stringify(nativeExternals)});
    b.onResolve({ filter: /.*/ }, args => {
      if (natives.has(args.path)) {
        return { path: args.path, namespace: "native-require" };
      }
    });
    b.onLoad({ filter: /.*/, namespace: "native-require" }, args => ({
      contents: "export default require(" + JSON.stringify(args.path) + ");",
      loader: "js",
    }));
  },
};

await build({
  entryPoints: [${JSON.stringify(entry)}],
  outfile: ${JSON.stringify(outfile)},
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  banner: { js: ${JSON.stringify(banner)} },
  plugins: [nativeRequirePlugin],
  external: ["node:*", "grammy", "discord.js", "googleapis"],
  // Let plugins import gateway deps (e.g. @anthropic-ai/sdk) that aren't
  // in the plugin's own node_modules. Without this, only the explicitly
  // aliased @agi/* packages resolve at build time.
  nodePaths: [
    ${JSON.stringify(resolve(agiDir, "node_modules"))},
    ${JSON.stringify(resolve(agiDir, "node_modules", ".pnpm", "node_modules"))},
    ${JSON.stringify(resolve(agiDir, "packages", "gateway-core", "node_modules"))},
  ],
  alias: {
    "@agi/sdk": ${JSON.stringify(resolve(agiDir, "packages/aion-sdk/src/index.ts"))},
    "@agi/plugins": ${JSON.stringify(resolve(agiDir, "packages/plugins/src/index.ts"))},
    "@agi/channel-sdk": ${JSON.stringify(resolve(agiDir, "packages/channel-sdk/src/index.ts"))},
    "@agi/gateway-core": ${JSON.stringify(resolve(agiDir, "packages/gateway-core/src/index.ts"))},
    "@agi/config": ${JSON.stringify(resolve(agiDir, "config/src/index.ts"))},
    // Backward compat for marketplace plugins that still import @aionima/*
    "@aionima/sdk": ${JSON.stringify(resolve(agiDir, "packages/aion-sdk/src/index.ts"))},
    "@aionima/plugins": ${JSON.stringify(resolve(agiDir, "packages/plugins/src/index.ts"))},
    "@aionima/channel-sdk": ${JSON.stringify(resolve(agiDir, "packages/channel-sdk/src/index.ts"))},
    "@aionima/gateway-core": ${JSON.stringify(resolve(agiDir, "packages/gateway-core/src/index.ts"))},
    "@aionima/config": ${JSON.stringify(resolve(agiDir, "config/src/index.ts"))},
  },
  logLevel: "warning",
});
`;

  try {
    sudoMkdir(join(dir, "dist"));
    sudoWriteFile(buildScript, scriptContent);
    execSync(
      `sudo node ${shellEscape(buildScript)}`,
      { cwd: agiDir, stdio: "pipe", timeout: 30_000 },
    );
  } catch (err) {
    // Log but don't throw — plugin may partially work without build
    console.error(`plugin build failed for ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try { execSync(`sudo rm -f ${shellEscape(buildScript)}`, { stdio: "pipe" }); } catch { /* ignore */ }
  }
}

/**
 * Rebuild a single installed plugin by re-running the esbuild step only.
 * Does not re-download or re-run npm install.
 */
export async function rebuildPlugin(installPath: string): Promise<void> {
  if (!existsSync(installPath)) {
    throw new Error(`Plugin directory not found: ${installPath}`);
  }
  await buildPlugin(installPath);
}

export interface RebuildAllResult {
  rebuilt: string[];
  failed: string[];
}

/**
 * Rebuild all plugins found in cacheDir by re-running the esbuild step.
 * Returns lists of rebuilt and failed plugin directory names.
 */
export async function rebuildAll(cacheDir: string): Promise<RebuildAllResult> {
  const installed = readdirSync(cacheDir).filter(d =>
    existsSync(join(cacheDir, d, "package.json"))
  );
  const rebuilt: string[] = [];
  const failed: string[] = [];
  for (const name of installed) {
    try {
      await buildPlugin(join(cacheDir, name));
      rebuilt.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { rebuilt, failed };
}

/** Uninstall a plugin by removing its install path. */
export function uninstallPlugin(installPath: string): void {
  if (existsSync(installPath)) {
    sudoRm(installPath);
  }
}

/** Escape a string for safe shell argument use. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
