/**
 * `aionima doctor` — Config-aware self-diagnostics with grouped checks.
 */

import { existsSync } from "node:fs";
import { access, constants, readFile } from "node:fs/promises";
import { execSync, execFileSync } from "node:child_process";
import { homedir } from "node:os";
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

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerDoctorCommand(program: Command): void {
  program
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
        groups.push(pluginChecks());

        const hosting = hostingChecks(config);
        if (hosting) groups.push(hosting);

        const dev = devChecks(config);
        if (dev) groups.push(dev);

        groups.push(await gatewayChecks(config));
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
}
