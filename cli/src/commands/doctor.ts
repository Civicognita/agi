/**
 * `aionima doctor` — Config-aware self-diagnostics with grouped checks.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { access, constants, readFile } from "node:fs/promises";
import { execSync, execFileSync } from "node:child_process";
import { homedir, hostname as osHostname, platform as osPlatform, release as osRelease, totalmem, freemem } from "node:os";
import { resolve, join } from "node:path";
import type { Command } from "commander";
import { loadConfig, validateConfigFile } from "../config-loader.js";
import { GatewayClient } from "../gateway-client.js";
import { bold, dim, formatCheck, green, red, yellow } from "../output.js";
import type { AionimaConfig } from "@agi/config";

interface Check {
  name: string;
  ok: boolean;
  warn?: boolean;
  fix?: string;
}

interface CheckGroup {
  title: string;
  checks: Check[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dirExists(path: string): boolean {
  return existsSync(path);
}

function fileExists(path: string): boolean {
  return existsSync(path);
}

function execVersion(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

function formatWarn(label: string): string {
  return `${yellow("⚠")} ${label}`;
}

function formatResult(check: Check): string {
  if (check.ok) return formatCheck(true, check.name);
  if (check.warn) return formatWarn(check.name);
  return formatCheck(false, check.name);
}

// ---------------------------------------------------------------------------
// Check groups
// ---------------------------------------------------------------------------

async function coreChecks(configPath?: string): Promise<{ group: CheckGroup; config: AionimaConfig | null; configOk: boolean }> {
  const checks: Check[] = [];
  let config: AionimaConfig | null = null;
  let configOk = false;

  // Config file
  const configResult = await validateConfigFile(configPath);
  configOk = configResult.errors === null;
  checks.push({
    name: "Config file",
    ok: configOk,
    fix: configResult.errors
      ? `Fix config at ${configResult.path}: ${configResult.errors.join(", ")}`
      : undefined,
  });

  // Load config for downstream checks
  if (configOk) {
    try {
      const result = await loadConfig(configPath);
      config = result.config;
    } catch { /* validation already reported */ }
  }

  // Node.js version
  const nodeVersion = process.versions.node ?? "";
  const major = parseInt(nodeVersion.split(".")[0] ?? "0", 10);
  const nodeOk = major >= 22;
  checks.push({
    name: `Node.js (v${nodeVersion})`,
    ok: nodeOk,
    fix: nodeOk ? undefined : "Upgrade to Node.js >= 22.0.0",
  });

  // Data directory (~/.agi/)
  const agiDir = resolve(homedir(), ".agi");
  let agiDirOk = false;
  try {
    if (existsSync(agiDir)) {
      await access(agiDir, constants.W_OK);
      agiDirOk = true;
    }
  } catch { /* not writable */ }
  checks.push({
    name: `Data directory (${agiDir})`,
    ok: agiDirOk,
    fix: agiDirOk ? undefined : `Create data dir: mkdir -p ${agiDir}`,
  });

  // Entity database
  const dbPath = config?.entities?.path ?? join(agiDir, "entities.db");
  const dbDir = resolve(dbPath, "..");
  const dbOk = dirExists(dbDir);
  checks.push({
    name: "Entity database",
    ok: dbOk,
    fix: dbOk ? undefined : "Database directory missing. Run: aionima run (auto-creates on first boot)",
  });

  // Systemd service
  const serviceOk = fileExists("/etc/systemd/system/agi.service");
  checks.push({
    name: "Systemd service",
    ok: serviceOk,
    fix: serviceOk ? undefined : "Install: sudo cp scripts/agi.service /etc/systemd/system/ && sudo systemctl daemon-reload",
  });

  // Deploy directory
  const deployOk = dirExists("/opt/agi");
  checks.push({
    name: "Deploy directory",
    ok: deployOk,
    fix: deployOk ? undefined : "Create: sudo mkdir -p /opt/agi && sudo chown $USER:$USER /opt/agi",
  });

  // No secrets in config
  if (configOk) {
    try {
      const rawConfig = await readFile(configResult.path, "utf-8");
      const secretPatterns = ["sk-ant-", "sk-proj-"];
      const found = secretPatterns.filter((p) => rawConfig.includes(p));
      checks.push({
        name: "No secrets in config",
        ok: found.length === 0,
        fix: found.length > 0 ? "Move secrets to .env and use $ENV{} references" : undefined,
      });
    } catch { /* can't read — already covered */ }
  }

  return { group: { title: "Core", checks }, config, configOk };
}

function authChecks(config: AionimaConfig): CheckGroup {
  const checks: Check[] = [];

  // API key — check providers config or env vars
  const hasProviderKey = config.providers && Object.values(config.providers).some(
    (p) => (p as { apiKey?: string }).apiKey,
  );
  const hasEnvKey =
    (process.env["ANTHROPIC_API_KEY"] ?? "").length > 0 ||
    (process.env["OPENAI_API_KEY"] ?? "").length > 0;
  const apiKeyOk = Boolean(hasProviderKey) || hasEnvKey;
  checks.push({
    name: "LLM API key",
    ok: apiKeyOk,
    fix: apiKeyOk ? undefined : "Set ANTHROPIC_API_KEY or OPENAI_API_KEY via onboarding or .env",
  });

  // Auth method configured
  const hasTokens = (config.auth?.tokens?.length ?? 0) > 0;
  const hasPassword = Boolean(config.auth?.password);
  const hasDashAuth = Boolean(config.dashboardAuth?.enabled);
  const authOk = hasTokens || hasPassword || hasDashAuth;
  checks.push({
    name: "Auth method configured",
    ok: authOk,
    warn: !authOk,
    fix: authOk ? undefined : "No auth tokens, password, or dashboard auth configured",
  });

  // Secrets directory
  const secretsDir = resolve(homedir(), ".agi/secrets");
  const secretsOk = dirExists(secretsDir);
  checks.push({
    name: "Secrets directory",
    ok: secretsOk,
    fix: secretsOk ? undefined : `Create: mkdir -p ${secretsDir} && chmod 0700 ${secretsDir}`,
  });

  // TPM2
  let tpm2Ok = false;
  try {
    const result = execSync("systemd-creds has-tpm2", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    tpm2Ok = result.includes("yes");
  } catch { /* not available */ }
  checks.push({
    name: "TPM2 available",
    ok: tpm2Ok,
    warn: !tpm2Ok,
    fix: tpm2Ok ? undefined : "TPM2 not detected — secrets fall back to process.env (not hardware-sealed)",
  });

  return { title: "Auth & Security", checks };
}

function repoChecks(config: AionimaConfig): CheckGroup {
  const checks: Check[] = [];

  const mappMarketplaceConfig = (config as Record<string, unknown>).mappMarketplace as Record<string, string> | undefined;
  const repos = [
    {
      name: "PRIME corpus",
      path: config.prime?.dir ?? "/opt/agi-prime",
      repo: "https://github.com/Civicognita/aionima.git",
    },
    {
      name: "Plugin Marketplace",
      path: config.marketplace?.dir ?? "/opt/agi-marketplace",
      repo: "https://github.com/Civicognita/agi-marketplace.git",
    },
    {
      name: "MApp Marketplace",
      path: mappMarketplaceConfig?.dir ?? "/opt/agi-mapp-marketplace",
      repo: "https://github.com/Civicognita/agi-mapp-marketplace.git",
    },
    {
      name: "ID service",
      path: config.idService?.dir ?? "/opt/agi-local-id",
      repo: "https://github.com/Civicognita/agi-local-id.git",
    },
  ];

  for (const repo of repos) {
    const exists = dirExists(repo.path);
    const isIdService = repo.name === "ID service";
    checks.push({
      name: `${repo.name} (${repo.path})`,
      ok: exists,
      warn: !exists && isIdService,
      fix: exists ? undefined : isIdService
        ? `${repo.name} not found — federation features unavailable. Fix: sudo git clone ${repo.repo} ${repo.path} && sudo chown -R $USER:$USER ${repo.path}`
        : `Fix: sudo git clone ${repo.repo} ${repo.path} && sudo chown -R $USER:$USER ${repo.path}`,
    });

    // Protocol compatibility
    if (exists) {
      const protoPath = join(repo.path, "protocol.json");
      const protoOk = fileExists(protoPath);
      if (!protoOk) {
        checks.push({
          name: `  protocol.json in ${repo.name}`,
          ok: false,
          warn: true,
          fix: "Missing protocol.json — version compatibility cannot be verified",
        });
      }
    }
  }

  return { title: "Multi-Repo", checks };
}

// ---------------------------------------------------------------------------
// Git state — per-project + sacred repos (s144 t577)
// ---------------------------------------------------------------------------

/**
 * Result of inspecting a single repo's git state. `null` when the path
 * isn't a git working tree (or git is unavailable / the call fails).
 */
export interface GitRepoState {
  staged: number;
  unstaged: number;
  untracked: number;
  upstreamSet: boolean;
  ahead: number;
  behind: number;
}

/**
 * Parse `git status --porcelain=v2 --branch` output into a GitRepoState.
 * Pure function — pulled out for unit testing without shelling out.
 */
export function parseGitPorcelainV2(out: string): GitRepoState {
  const lines = out.split("\n");
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let upstreamSet = false;
  let ahead = 0;
  let behind = 0;

  for (const line of lines) {
    if (line.startsWith("# branch.upstream ")) {
      upstreamSet = true;
    } else if (line.startsWith("# branch.ab ")) {
      // Format: "# branch.ab +N -M"
      const m = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Tracked-changed entry. Field 2 is the XY status (e.g. ".M", "M.", "MM").
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const indexFlag = xy[0] ?? ".";
      const worktreeFlag = xy[1] ?? ".";
      if (indexFlag !== "." && indexFlag !== "?") staged++;
      if (worktreeFlag !== "." && worktreeFlag !== "?") unstaged++;
    } else if (line.startsWith("? ")) {
      untracked++;
    }
  }

  return { staged, unstaged, untracked, upstreamSet, ahead, behind };
}

function readGitState(repoPath: string): GitRepoState | null {
  try {
    const out = execFileSync("git", ["status", "--porcelain=v2", "--branch"], {
      cwd: repoPath,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "ignore"],
    });
    return parseGitPorcelainV2(out);
  } catch {
    return null;
  }
}

/** Render a one-line summary of a repo's git state (or `null` if not git). */
function summarizeGitState(state: GitRepoState | null): { ok: boolean; warn: boolean; summary: string } {
  if (state === null) return { ok: true, warn: false, summary: "not a git repo (skipping)" };

  const parts: string[] = [];
  const dirty = state.staged > 0 || state.unstaged > 0 || state.untracked > 0;
  if (state.staged > 0) parts.push(`${String(state.staged)} staged`);
  if (state.unstaged > 0) parts.push(`${String(state.unstaged)} unstaged`);
  if (state.untracked > 0) parts.push(`${String(state.untracked)} untracked`);
  if (!state.upstreamSet) parts.push("no upstream");
  else if (state.ahead > 0) parts.push(`${String(state.ahead)} unpushed`);
  if (state.behind > 0) parts.push(`${String(state.behind)} behind`);

  if (parts.length === 0) return { ok: true, warn: false, summary: "clean + in sync" };

  // Mix of staged + unstaged is a warning (looks like a half-finished commit).
  const stagedMix = state.staged > 0 && state.unstaged > 0;
  return {
    ok: !dirty && state.upstreamSet && state.ahead === 0,
    warn: stagedMix || !state.upstreamSet,
    summary: parts.join(", "),
  };
}

function gitStateChecks(config: AionimaConfig): CheckGroup {
  const checks: Check[] = [];

  // Sacred repos (mirror the set in repoChecks, which only verifies existence).
  const mappMarketplaceConfig = (config as Record<string, unknown>).mappMarketplace as Record<string, string> | undefined;
  const sacred = [
    { name: "PRIME corpus", path: config.prime?.dir ?? "/opt/agi-prime" },
    { name: "Plugin Marketplace", path: config.marketplace?.dir ?? "/opt/agi-marketplace" },
    { name: "MApp Marketplace", path: mappMarketplaceConfig?.dir ?? "/opt/agi-mapp-marketplace" },
    { name: "ID service", path: config.idService?.dir ?? "/opt/agi-local-id" },
  ];

  for (const repo of sacred) {
    if (!dirExists(repo.path)) continue; // existence-warning surfaced by repoChecks
    const state = readGitState(repo.path);
    const { ok, warn, summary } = summarizeGitState(state);
    checks.push({
      name: `${repo.name} — ${summary}`,
      ok,
      warn,
      fix: ok ? undefined : "Repair actions land with `agi doctor` TUI (s144 t574)",
    });
  }

  // Workspace projects.
  const workspaceProjects = config.workspace?.projects ?? [];
  for (const projectPath of workspaceProjects) {
    if (!dirExists(projectPath)) continue;
    const state = readGitState(projectPath);
    const { ok, warn, summary } = summarizeGitState(state);
    checks.push({
      name: `${projectPath} — ${summary}`,
      ok,
      warn,
      fix: ok ? undefined : "Repair actions land with `agi doctor` TUI (s144 t574)",
    });
  }

  return { title: "Git state", checks };
}

function pluginChecks(): CheckGroup {
  const checks: Check[] = [];

  // Required plugins manifest
  const reqPath = join(process.cwd(), "config/required-plugins.json");
  const reqOk = fileExists(reqPath);
  checks.push({
    name: "Required plugins manifest",
    ok: reqOk,
    fix: reqOk ? undefined : "Missing config/required-plugins.json",
  });

  // Plugin cache directory
  const cacheDir = resolve(homedir(), ".agi/plugins/cache");
  const cacheOk = dirExists(cacheDir);
  checks.push({
    name: "Plugin cache directory",
    ok: cacheOk,
    fix: cacheOk ? undefined : `Create: mkdir -p ${cacheDir}`,
  });

  // Marketplace database
  const marketDbPath = resolve(homedir(), ".agi/marketplace.db");
  const altMarketDbPath = join(process.cwd(), "data/marketplace.db");
  const marketDbOk = fileExists(marketDbPath) || fileExists(altMarketDbPath);
  checks.push({
    name: "Marketplace database",
    ok: marketDbOk,
    warn: !marketDbOk,
    fix: marketDbOk ? undefined : "Auto-created on first boot — run: aionima run",
  });

  return { title: "Plugins & Marketplace", checks };
}

/**
 * s150 t641 — per-project shape diagnostic. Walks every project under each
 * `workspace.projects[]` directory and verifies the s150 model:
 *   - no top-level `category` field
 *   - no `hosting.containerKind` field
 *   - no `<projectPath>/.agi/project.json` debris
 *   - top-level `type` set + not in retired set
 *   - `repos/`, `sandbox/`, `.trash/`, `k/{plans,knowledge,pm,memory,chat}` present
 *
 * Each project becomes one row. A clean project shows ✓; a project with
 * any drift shows ✗ with a multi-line `fix` listing every finding.
 */
async function projectShapeChecks(config: AionimaConfig): Promise<CheckGroup | null> {
  const workspaces = config.workspace?.projects ?? [];
  if (workspaces.length === 0) return null;

  const checks: Check[] = [];
  const RETIRED_TYPES: ReadonlySet<string> = new Set(["monorepo"]);
  const REQUIRED_DIRS = ["repos", "sandbox", ".trash", "k/plans", "k/knowledge", "k/pm", "k/memory", "k/chat"];
  const SACRED_NAMES = new Set([
    "_aionima", "agi", "prime", "id", "marketplace", "mapp-marketplace",
    "react-fancy", "fancy-code", "fancy-sheets", "fancy-echarts", "fancy-3d", "fancy-screens",
  ]);

  const { readdirSync } = await import("node:fs");
  const path = await import("node:path");

  let scanned = 0;
  for (const ws of workspaces) {
    let entries: string[];
    try {
      entries = readdirSync(ws, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);
    } catch {
      continue;
    }

    for (const slug of entries) {
      if (SACRED_NAMES.has(slug.toLowerCase())) continue;
      const projectPath = path.join(ws, slug);
      const findings: string[] = [];

      const configPath = path.join(projectPath, "project.json");
      if (!fileExists(configPath)) {
        // Pre-scaffold project — skip; nothing to validate yet.
        continue;
      }
      scanned++;

      let raw: Record<string, unknown> = {};
      try {
        raw = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
      } catch (e) {
        findings.push(`unparseable project.json (${e instanceof Error ? e.message : String(e)})`);
      }

      if ("category" in raw) findings.push("legacy `category` field present (s150 t630/t632)");

      const hosting = raw.hosting as Record<string, unknown> | undefined;
      if (hosting && "containerKind" in hosting) findings.push("legacy `hosting.containerKind` field present (s150 t634)");

      const agiDebris = path.join(projectPath, ".agi", "project.json");
      if (fileExists(agiDebris)) findings.push("`.agi/project.json` debris (s130 → s140 leftover)");

      const type = typeof raw.type === "string" ? raw.type : null;
      if (type === null || type.length === 0) {
        findings.push("top-level `type` is missing");
      } else if (RETIRED_TYPES.has(type)) {
        findings.push(`type "${type}" was retired (s150 t640) — boot sweep will remap to "web-app"`);
      }

      for (const rel of REQUIRED_DIRS) {
        const abs = path.join(projectPath, rel);
        if (!dirExists(abs)) findings.push(`missing dir: ${rel}/`);
      }
      // sandbox + .trash also count as required (covered above).

      checks.push({
        name: findings.length === 0 ? `${slug}: shape clean` : `${slug}: ${String(findings.length)} drift finding(s)`,
        ok: findings.length === 0,
        warn: findings.length > 0 && findings.every((f) => f.startsWith("legacy") || f.includes("debris") || f.includes("retired")),
        fix: findings.length === 0 ? undefined : findings.map((f) => `• ${f}`).join("\n"),
      });
    }
  }

  if (scanned === 0) return null;
  return { title: "Project shape (s150)", checks };
}

function hostingChecks(config: AionimaConfig): CheckGroup | null {
  if (!config.hosting?.enabled) return null;

  const checks: Check[] = [];

  // Podman
  const podmanOutput = execVersion("podman --version");
  const podmanOk = podmanOutput !== null;
  const podmanVersion = podmanOutput?.replace("podman version ", "") ?? "";
  checks.push({
    name: podmanOk ? `Podman (v${podmanVersion})` : "Podman",
    ok: podmanOk,
    fix: podmanOk ? undefined : "Install: sudo apt install podman",
  });

  // Caddy
  const caddyOutput = execVersion("caddy version");
  const caddyOk = caddyOutput !== null;
  const caddyVersion = caddyOutput?.split(" ")[0] ?? "";
  checks.push({
    name: caddyOk ? `Caddy (${caddyVersion})` : "Caddy",
    ok: caddyOk,
    fix: caddyOk ? undefined : "Install Caddy: see scripts/hosting-setup.sh",
  });

  // dnsmasq
  const dnsmasqOutput = execVersion("systemctl is-active dnsmasq");
  const dnsmasqOk = dnsmasqOutput === "active";
  checks.push({
    name: "dnsmasq",
    ok: dnsmasqOk,
    warn: !dnsmasqOk,
    fix: dnsmasqOk ? undefined : "Install: sudo apt install dnsmasq (required for local .ai.on domains)",
  });

  // Base domain
  const baseDomain = config.hosting.baseDomain;
  const domainOk = Boolean(baseDomain);
  checks.push({
    name: domainOk ? `Base domain (${baseDomain})` : "Base domain",
    ok: domainOk,
    fix: domainOk ? undefined : "Set hosting.baseDomain in config (e.g. \"ai.on\")",
  });

  return { title: "Hosting", checks };
}

function getOriginUrl(dir: string): string | null {
  try {
    return execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

function devChecks(config: AionimaConfig): CheckGroup | null {
  if (!config.dev?.enabled) return null;

  const checks: Check[] = [];

  // Origin alignment — since v0.4.66's `ensure_origin_remote` in
  // upgrade.sh repoints /opt/agi* origins to the owner's fork on each
  // upgrade cycle. If any origin is still pointing at Civicognita
  // despite Dev Mode being enabled, `agi upgrade` hasn't completed the
  // one-time migration yet. Flag red with a one-line remediation.
  type OriginCheck = {
    name: string;
    dir: string;
    expectedRepo: string | undefined;
  };
  const originChecks: OriginCheck[] = [
    { name: "AGI origin", dir: "/opt/agi", expectedRepo: config.dev.agiRepo },
    { name: "PRIME origin", dir: "/opt/agi-prime", expectedRepo: config.dev.primeRepo },
    { name: "ID origin", dir: "/opt/agi-local-id", expectedRepo: config.dev.idRepo },
  ];

  for (const { name, dir, expectedRepo } of originChecks) {
    if (!dirExists(dir)) {
      checks.push({
        name: `${name}: ${dir} not present`,
        ok: false,
        fix: "Run the AGI installer first.",
      });
      continue;
    }
    const current = getOriginUrl(dir);
    if (current === null) {
      checks.push({
        name: `${name}: could not read ${dir}/.git/config`,
        ok: false,
        fix: "Check that the directory is a valid git repo and readable by the current user.",
      });
      continue;
    }
    if (!expectedRepo || expectedRepo.length === 0) {
      // Dev Mode is on but this fork URL isn't configured. Probably an
      // older install that toggled Dev Mode before v0.4.64 populated
      // the dev.*Repo fields. User needs to re-toggle Dev Mode.
      const repoSlug = name.toLowerCase().split(" ")[0];
      checks.push({
        name: `${name}: no dev.${repoSlug}Repo configured`,
        ok: false,
        warn: true,
        fix: "Toggle Dev Mode off then on in the dashboard — /api/dev/switch will populate the fork URLs.",
      });
      continue;
    }
    const aligned = current === expectedRepo;
    checks.push({
      name: `${name}: ${current}`,
      ok: aligned,
      warn: !aligned,
      fix: aligned
        ? undefined
        : `Expected ${expectedRepo}. Run \`agi upgrade\` — ensure_origin_remote in upgrade.sh rewrites this on every cycle.`,
    });
  }

  // NPU hardware check — Phase K.7 feeds in here too. If the kernel
  // exposes /dev/accel/accel0 the AMD XDNA NPU is present. That alone
  // doesn't mean it's USABLE (userspace from the agi-lemonade-runtime
  // plugin handles that), but the hardware probe is a good first signal.
  const npuPresent = dirExists("/dev/accel/accel0");
  if (npuPresent || dirExists("/sys/class/accel")) {
    checks.push({
      name: "NPU hardware: /dev/accel/accel0",
      ok: npuPresent,
      warn: !npuPresent,
      fix: npuPresent
        ? undefined
        : "NPU driver sysfs entry present but device node missing — reload amdxdna kernel module.",
    });
  }

  return { title: "Dev Mode", checks };
}

async function gatewayChecks(config: AionimaConfig): Promise<CheckGroup> {
  const checks: Check[] = [];

  const host = config.gateway?.host ?? "127.0.0.1";
  const port = config.gateway?.port ?? 3100;
  const client = new GatewayClient(host, port);
  const gatewayOk = await client.ping();
  checks.push({
    name: `Gateway (${host}:${String(port)})`,
    ok: gatewayOk,
    fix: gatewayOk ? undefined : "Start: sudo systemctl start agi",
  });

  // Dashboard built
  const selfRepo = config.workspace?.selfRepo ?? "/opt/agi";
  const dashIndex = join(selfRepo, "ui/dashboard/dist/index.html");
  const dashOk = fileExists(dashIndex);
  checks.push({
    name: "Dashboard built",
    ok: dashOk,
    warn: !dashOk,
    fix: dashOk ? undefined : "Build: cd /opt/agi && pnpm build",
  });

  return { title: "Gateway", checks };
}

/**
 * Lemonade runtime checks — Phase K.7 of the v0.4.0 closing plan.
 *
 * Probes `/api/lemonade/status` through the gateway. When the runtime
 * plugin isn't installed the gateway returns 503; that single "not
 * installed" finding supersedes the remaining checks. Otherwise we
 * surface version, running-state, backend availability, and provider
 * registration. NPU hardware presence is already flagged by devChecks
 * (Dev Mode group) so we don't duplicate it here.
 */
async function lemonadeChecks(config: AionimaConfig): Promise<CheckGroup | null> {
  const host = config.gateway?.host ?? "127.0.0.1";
  const port = config.gateway?.port ?? 3100;
  const client = new GatewayClient(host, port);
  const gatewayReachable = await client.ping();
  if (!gatewayReachable) {
    // Gateway itself is down; suppressing this group prevents a noisy
    // cascade of failures that really all point at "gateway not running".
    return null;
  }

  const checks: Check[] = [];
  const status = await client.lemonadeStatus();

  if (status === null) {
    checks.push({
      name: "Lemonade runtime: not installed (proxy 503)",
      ok: false,
      warn: true,
      fix: "Install the agi-lemonade-runtime plugin from the Plugin Marketplace.",
    });
    // Config-side check still runs — catches the case where provider is
    // configured but the runtime plugin was removed.
    const hasProvider = Boolean(config.providers?.["lemonade"]);
    checks.push({
      name: `Lemonade provider in config: ${hasProvider ? "present" : "absent"}`,
      ok: hasProvider,
      warn: !hasProvider,
      fix: hasProvider
        ? undefined
        : "Once the plugin is installed, /api/dev/switch (or Settings > Providers) registers the provider.",
    });
    return { title: "Lemonade", checks };
  }

  // Runtime plugin reachable — drill into version, backends, provider.
  const versionLabel = status.version ? ` v${status.version}` : "";
  checks.push({
    name: `Lemonade runtime: installed${versionLabel}`,
    ok: Boolean(status.installed),
    warn: !status.installed,
    fix: status.installed
      ? undefined
      : "Plugin reports installed=false — reinstall via the Plugin Marketplace.",
  });

  checks.push({
    name: `Lemonade server: ${status.running ? "running" : "stopped"}`,
    ok: Boolean(status.running),
    warn: !status.running,
    fix: status.running
      ? undefined
      : "Start the Lemonade service from the plugin's Settings page or the CLI tool.",
  });

  // Backends — each reports independently. At least one needs to be
  // available for Lemonade to serve; warn if all three are missing.
  const npuAvailable = Boolean(status.devices?.amd_npu?.available);
  const igpuAvailable = Boolean(status.devices?.amd_igpu?.available);
  const cpuAvailable = Boolean(status.devices?.cpu?.available);
  checks.push({
    name: `Lemonade backend: AMD NPU ${npuAvailable ? "available" : "unavailable"}`,
    ok: npuAvailable,
    warn: !npuAvailable,
    fix: npuAvailable
      ? undefined
      : "Optional backend — AMD XDNA NPU not detected by Lemonade. CPU/iGPU still work.",
  });
  checks.push({
    name: `Lemonade backend: AMD iGPU ${igpuAvailable ? "available" : "unavailable"}`,
    ok: igpuAvailable,
    warn: !igpuAvailable,
    fix: igpuAvailable
      ? undefined
      : "Optional backend — AMD integrated GPU not detected by Lemonade.",
  });
  checks.push({
    name: `Lemonade backend: CPU ${cpuAvailable ? "available" : "unavailable"}`,
    ok: cpuAvailable,
    warn: !cpuAvailable,
    fix: cpuAvailable
      ? undefined
      : "CPU backend unexpectedly absent — Lemonade normally always has CPU available.",
  });

  // Active model loaded — not a hard requirement but signals readiness.
  if (status.activeModel !== undefined && status.activeModel !== null && status.activeModel !== "") {
    checks.push({
      name: `Lemonade active model: ${status.activeModel}`,
      ok: true,
    });
  } else {
    checks.push({
      name: "Lemonade active model: none loaded",
      ok: false,
      warn: true,
      fix: "Pull a model via the Lemonade plugin's Models page, or via the lemonade_pull agent tool.",
    });
  }

  // Config-side provider registration.
  const hasProvider = Boolean(config.providers?.["lemonade"]);
  checks.push({
    name: `Lemonade provider in config: ${hasProvider ? "present" : "absent"}`,
    ok: hasProvider,
    warn: !hasProvider,
    fix: hasProvider
      ? undefined
      : "Provider auto-registers when the plugin activates; re-enable the plugin if this row stays absent.",
  });

  return { title: "Lemonade", checks };
}

// ---------------------------------------------------------------------------
// `agi doctor dump` — Diagnostic bundle for incident triage (s144 t579)
// ---------------------------------------------------------------------------

/** Sanitize a gateway.json-shape object — strip obvious secret-bearing keys. */
export function redactConfig(value: unknown): unknown {
  const SECRET_KEY_RE = /(secret|password|token|apikey|api_key|credential|private[-_]?key)/i;
  if (Array.isArray(value)) return value.map(redactConfig);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = typeof v === "string" && v.length > 0 ? `<redacted:${String(v.length)}-chars>` : "<redacted>";
      } else {
        out[k] = redactConfig(v);
      }
    }
    return out;
  }
  return value;
}

/** Read up to N most-recent lines of a file (best-effort). Returns [] on any error. */
function tailFile(path: string, lines: number): string[] {
  try {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8");
    const all = raw.split("\n");
    return all.slice(Math.max(0, all.length - lines));
  } catch {
    return [];
  }
}

/** Collect a doctor diagnostic bundle and write it to ~/.agi/doctor-dumps/. */
async function runDoctorDump(opts: { config?: string }): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpDir = join(homedir(), ".agi", "doctor-dumps");
  mkdirSync(dumpDir, { recursive: true });
  const outPath = join(dumpDir, `dump-${timestamp}.json`);

  // 1. Diagnostic checks (re-use the existing groups).
  const groups: CheckGroup[] = [];
  const { group: core, config, configOk } = await coreChecks(opts.config);
  groups.push(core);
  if (config && configOk) {
    groups.push(authChecks(config));
    groups.push(repoChecks(config));
    groups.push(gitStateChecks(config));
    groups.push(pluginChecks());
    const hosting = hostingChecks(config);
    if (hosting) groups.push(hosting);
    const shape = await projectShapeChecks(config);
    if (shape) groups.push(shape);
    const dev = devChecks(config);
    if (dev) groups.push(dev);
    groups.push(await gatewayChecks(config));
    const lemonade = await lemonadeChecks(config);
    if (lemonade) groups.push(lemonade);
  }

  // 2. Sanitized config + system info + log tails + workspace projects.
  const redactedConfig = config ? redactConfig(config) : null;

  const sys = {
    hostname: osHostname(),
    platform: osPlatform(),
    release: osRelease(),
    nodeVersion: process.version,
    totalMemMB: Math.round(totalmem() / 1024 / 1024),
    freeMemMB: Math.round(freemem() / 1024 / 1024),
    podmanVersion: execVersion("podman --version"),
    gitVersion: execVersion("git --version"),
  };

  const logsDir = join(homedir(), ".agi", "logs");
  const logTails: Record<string, string[]> = {};
  if (existsSync(logsDir)) {
    try {
      const entries = readdirSync(logsDir).filter((f) => f.endsWith(".log") || f.endsWith(".jsonl"));
      const ranked = entries.map((f) => {
        const p = join(logsDir, f);
        try { return { f, mtime: statSync(p).mtimeMs }; } catch { return { f, mtime: 0 }; }
      }).sort((a, b) => b.mtime - a.mtime).slice(0, 5);
      for (const { f } of ranked) logTails[f] = tailFile(join(logsDir, f), 200);
    } catch {
      // ignore
    }
  }
  const tmpLog = "/tmp/agi.log";
  if (existsSync(tmpLog)) logTails["/tmp/agi.log"] = tailFile(tmpLog, 200);

  const workspaceProjects: { path: string; type?: string; exists: boolean }[] = [];
  if (config?.workspace?.projects) {
    for (const p of config.workspace.projects) {
      const projJson = join(p, "project.json");
      let type: string | undefined;
      if (existsSync(projJson)) {
        try {
          const raw = await readFile(projJson, "utf8");
          const parsed = JSON.parse(raw) as { type?: string };
          type = parsed.type;
        } catch {
          // ignore
        }
      }
      workspaceProjects.push({ path: p, type, exists: existsSync(p) });
    }
  }

  const allChecks = groups.flatMap((g) => g.checks);
  const bundle = {
    bundleVersion: 1,
    bundleId: timestamp,
    generatedAt: new Date().toISOString(),
    cliVersion: process.env["AGI_CLI_VERSION"] ?? "unknown",
    system: sys,
    checks: {
      groups,
      summary: {
        total: allChecks.length,
        passed: allChecks.filter((c) => c.ok).length,
        warnings: allChecks.filter((c) => !c.ok && c.warn).length,
        failed: allChecks.filter((c) => !c.ok && !c.warn).length,
      },
    },
    config: redactedConfig,
    logTails,
    workspaceProjects,
  };

  writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf-8");
  return outPath;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerDoctorCommand(program: Command): void {
  const doctor = program
    .command("doctor")
    .description("Run self-diagnostics")
    .option("--json", "Output results as JSON")
    .option("--with-aion", "Use aion-micro for AI-powered diagnostic analysis")
    .action(async (cmdOpts: { json?: boolean; withAion?: boolean }) => {
      const opts = program.opts<{ config?: string; host?: string; port?: number }>();
      const groups: CheckGroup[] = [];

      // Core checks (always run, also loads config)
      const { group: core, config, configOk } = await coreChecks(opts.config);
      groups.push(core);

      if (config && configOk) {
        groups.push(authChecks(config));
        groups.push(repoChecks(config));
        groups.push(gitStateChecks(config));
        groups.push(pluginChecks());

        const hosting = hostingChecks(config);
        if (hosting) groups.push(hosting);

        // s150 t641 — per-project shape validation
        const shape = await projectShapeChecks(config);
        if (shape) groups.push(shape);

        const dev = devChecks(config);
        if (dev) groups.push(dev);

        groups.push(await gatewayChecks(config));

        const lemonade = await lemonadeChecks(config);
        if (lemonade) groups.push(lemonade);
      }

      // JSON output
      if (cmdOpts.json) {
        const allChecks = groups.flatMap((g) => g.checks.map((c) => ({ group: g.title, ...c })));
        const passed = allChecks.filter((c) => c.ok).length;
        const warnings = allChecks.filter((c) => !c.ok && c.warn).length;
        const failed = allChecks.filter((c) => !c.ok && !c.warn).length;
        console.log(JSON.stringify({ groups, summary: { total: allChecks.length, passed, warnings, failed } }, null, 2));
        if (failed > 0) process.exitCode = 1;
        return;
      }

      // Human output
      console.log();
      console.log(bold("  aionima doctor"));

      let totalPassed = 0;
      let totalWarnings = 0;
      let totalFailed = 0;
      let totalChecks = 0;

      for (const group of groups) {
        console.log();
        console.log(`  ${bold(group.title)}`);
        for (const check of group.checks) {
          console.log(`  ${formatResult(check)}`);
          if (check.fix && !check.ok) {
            console.log(`    ${dim(check.fix)}`);
          }
          totalChecks++;
          if (check.ok) totalPassed++;
          else if (check.warn) totalWarnings++;
          else totalFailed++;
        }
      }

      // AI-powered diagnostic analysis via aion-micro
      if (cmdOpts.withAion) {
        const gatewayHost = config?.gateway?.host ?? "127.0.0.1";
        const gatewayPort = config?.gateway?.port ?? 3100;
        const allChecks = groups.flatMap((g) => g.checks.map((c) => ({ group: g.title, ...c })));
        try {
          const res = await fetch(`http://${gatewayHost}:${String(gatewayPort)}/api/admin/diagnose`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checks: allChecks }),
            signal: AbortSignal.timeout(60_000),
          });
          if (res.ok) {
            const data = await res.json() as { analysis?: string };
            if (data.analysis) {
              console.log();
              console.log(`  ${bold("AI Analysis")} ${dim("(aion-micro)")}`);
              for (const line of data.analysis.split("\n")) {
                console.log(`  ${line}`);
              }
            }
          } else {
            console.log();
            console.log(`  ${dim("AI analysis unavailable — aion-micro image not installed")}`);
          }
        } catch {
          console.log();
          console.log(`  ${dim("AI analysis unavailable — gateway not reachable")}`);
        }
      }

      console.log();
      if (totalFailed === 0 && totalWarnings === 0) {
        console.log(`  ${green("All checks passed")} (${String(totalChecks)}/${String(totalChecks)})`);
      } else {
        const parts: string[] = [];
        if (totalFailed > 0) parts.push(red(`${String(totalFailed)} issue(s)`));
        if (totalWarnings > 0) parts.push(yellow(`${String(totalWarnings)} warning(s)`));
        console.log(`  ${parts.join(", ")} — ${String(totalPassed)}/${String(totalChecks)} passed`);
      }
      console.log();

      if (totalFailed > 0) process.exitCode = 1;
    });

  // s144 t579 — `agi doctor dump` writes a diagnostic bundle to
  // ~/.agi/doctor-dumps/dump-<timestamp>.json. Hands the path back so an
  // operator can attach it to a bug report or share it with support.
  doctor
    .command("dump")
    .description("Write a diagnostic bundle (logs + redacted config + checks + system info) to ~/.agi/doctor-dumps/")
    .action(async () => {
      const opts = program.opts<{ config?: string }>();
      try {
        const path = await runDoctorDump({ config: opts.config });
        console.log();
        console.log(`  ${green("✓")} diagnostic bundle written`);
        console.log(`  ${dim(path)}`);
        console.log();
      } catch (err) {
        console.error(`${red("✗")} failed to write bundle: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });
}
