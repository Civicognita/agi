/**
 * `aionima setup` — Interactive configuration wizard.
 *
 * Generates `aionima.json` (config with $ENV{} refs) and `.env` (secrets)
 * from user input. Uses node:readline/promises — no external deps.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import type { Command } from "commander";
import { AionimaConfigSchema } from "@aionima/config";
import { bold, cyan, dim, green, red, yellow } from "../output.js";
import {
  ask,
  askSecret,
  askYesNo,
  askChoice,
  askMultiSelect,
} from "./setup-prompts.js";

interface SetupContext {
  /** Where config/env files will be written. */
  targetDir: string;
  /** Whether we're in the deploy dir (vs the repo). */
  isDeployDir: boolean;
  /** Existing config (if migrating). */
  existingConfig: Record<string, unknown> | null;
}

interface SetupResult {
  config: Record<string, unknown>;
  envVars: Record<string, string>;
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive configuration wizard")
    .option("-d, --dir <path>", "Target directory for config files")
    .action(async (opts: { dir?: string }) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      try {
        console.log();
        console.log(bold("  aionima setup"));
        console.log(dim("  Interactive configuration wizard"));
        console.log();

        // Phase 1: Detect context
        const ctx = await detectContext(rl, opts.dir);

        // Phase 2-7: Collect configuration
        const result = await collectConfig(rl, ctx);

        // Phase 8: Generate files
        await generateFiles(ctx, result);

        // Phase 9: Post-setup
        printPostSetup(ctx);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") {
          // User pressed Ctrl+C
          console.log("\n" + dim("  Setup cancelled."));
        } else {
          console.error(
            `\n  ${red("Error:")} ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
        }
      } finally {
        rl.close();
      }
    });
}

// ---------------------------------------------------------------------------
// Phase 1: Detect context
// ---------------------------------------------------------------------------

async function detectContext(
  rl: Parameters<typeof ask>[0],
  dirOverride?: string,
): Promise<SetupContext> {
  const deployDir = "/opt/aionima";
  const cwd = process.cwd();

  let targetDir: string;
  let isDeployDir: boolean;

  if (dirOverride) {
    targetDir = resolve(dirOverride);
    isDeployDir = targetDir === deployDir;
  } else if (cwd.startsWith(deployDir)) {
    targetDir = deployDir;
    isDeployDir = true;
    console.log(dim(`  Detected deploy directory: ${deployDir}`));
  } else {
    targetDir = cwd;
    isDeployDir = false;
    console.log(dim(`  Working directory: ${cwd}`));
  }

  // Check for existing config
  let existingConfig: Record<string, unknown> | null = null;
  const configPath = resolve(targetDir, "aionima.json");

  if (existsSync(configPath)) {
    console.log(yellow(`  Existing config found: ${configPath}`));
    const migrate = await askYesNo(rl, "Use existing config as starting point?");
    if (migrate) {
      try {
        const raw = await readFile(configPath, "utf-8");
        existingConfig = JSON.parse(raw) as Record<string, unknown>;
        console.log(green("  Loaded existing config"));
      } catch (err) {
        console.log(
          red(
            `  Could not parse existing config: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }
  }

  console.log();
  return { targetDir, isDeployDir, existingConfig };
}

// ---------------------------------------------------------------------------
// Phases 2-7: Collect configuration
// ---------------------------------------------------------------------------

async function collectConfig(
  rl: Parameters<typeof ask>[0],
  ctx: SetupContext,
): Promise<SetupResult> {
  const config: Record<string, unknown> = {};
  const envVars: Record<string, string> = {};
  const existing = ctx.existingConfig ?? {};

  // -- Phase 2: Owner identity -------------------------------------------
  console.log(bold("  Owner Identity"));
  const existingOwner = (existing.owner as Record<string, unknown>) ?? {};

  const displayName = await ask(
    rl,
    "Display name",
    (existingOwner.displayName as string) ?? "Owner",
  );
  const dmPolicy = await askChoice(
    rl,
    "DM policy for unknown senders?",
    [
      { label: "Pairing code required", value: "pairing" as const },
      { label: "Open (allow all)", value: "open" as const },
    ],
    ((existingOwner.dmPolicy as string) ?? "pairing") as "pairing" | "open",
  );

  config.owner = { displayName, dmPolicy, channels: {} };
  console.log();

  // -- Phase 3: Gateway config -------------------------------------------
  console.log(bold("  Gateway"));
  const existingGw = (existing.gateway as Record<string, unknown>) ?? {};

  const host = await ask(
    rl,
    "Listen address",
    (existingGw.host as string) ?? "127.0.0.1",
  );
  const portStr = await ask(
    rl,
    "Port",
    String((existingGw.port as number) ?? 3100),
  );
  const port = parseInt(portStr, 10) || 3100;

  // Generate random auth token
  const authToken = randomBytes(32).toString("hex");
  envVars.AUTH_TOKEN = authToken;
  console.log(dim(`  Generated AUTH_TOKEN (saved to .env)`));

  config.gateway = { host, port, state: "ONLINE" };
  config.auth = { tokens: ["$ENV{AUTH_TOKEN}"] };
  console.log();

  // -- Phase 4: LLM Provider --------------------------------------------
  console.log(bold("  LLM Provider"));
  const existingAgent = (existing.agent as Record<string, unknown>) ?? {};

  const provider = await askChoice(
    rl,
    "Primary LLM provider?",
    [
      { label: "Anthropic (Claude)", value: "anthropic" as const },
      { label: "OpenAI", value: "openai" as const },
      { label: "Ollama (local)", value: "ollama" as const },
    ],
    ((existingAgent.provider as string) ?? "anthropic") as
      | "anthropic"
      | "openai"
      | "ollama",
  );

  if (provider === "anthropic" || provider === "openai") {
    const envKey =
      provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    const existing_key = process.env[envKey];
    if (existing_key) {
      console.log(
        dim(`  ${envKey} already set in environment — keeping it`),
      );
      envVars[envKey] = existing_key;
    } else {
      const apiKey = await askSecret(rl, `${envKey}`);
      if (apiKey) envVars[envKey] = apiKey;
    }
  }

  const defaultModel =
    provider === "anthropic"
      ? "claude-sonnet-4-6"
      : provider === "openai"
        ? "gpt-4o"
        : "llama3";
  const model = await ask(
    rl,
    "Model",
    (existingAgent.model as string) ?? defaultModel,
  );

  const replyMode = await askChoice(
    rl,
    "Reply mode?",
    [
      { label: "Autonomous (auto-reply)", value: "autonomous" as const },
      {
        label: "Human-in-loop (approve via dashboard)",
        value: "human-in-loop" as const,
      },
    ],
    ((existingAgent.replyMode as string) ?? "autonomous") as
      | "autonomous"
      | "human-in-loop",
  );

  const agentConfig: Record<string, unknown> = {
    provider,
    model,
    replyMode,
  };

  if (provider === "ollama") {
    const baseUrl = await ask(rl, "Ollama base URL", "http://localhost:11434");
    agentConfig.baseUrl = baseUrl;
  }

  config.agent = agentConfig;
  console.log();

  // -- Phase 5: Channels -------------------------------------------------
  console.log(bold("  Channels"));
  const selectedChannels = await askMultiSelect(rl, "Which channels to enable?", [
    { label: "Telegram", value: "telegram" as const },
    { label: "Discord", value: "discord" as const },
    { label: "Gmail", value: "gmail" as const },
    { label: "Signal", value: "signal" as const },
    { label: "WhatsApp", value: "whatsapp" as const },
  ]);

  const channels: Array<Record<string, unknown>> = [];
  const ownerChannels: Record<string, string> = {};

  for (const ch of selectedChannels) {
    const channelConfig: Record<string, unknown> = { id: ch, enabled: true };

    if (ch === "telegram") {
      const token = await askSecret(rl, "Telegram bot token");
      if (token) envVars.TELEGRAM_BOT_TOKEN = token;
      channelConfig.config = { botToken: "$ENV{TELEGRAM_BOT_TOKEN}" };
      const ownerId = await ask(rl, "Your Telegram user ID (numeric)");
      if (ownerId) ownerChannels.telegram = ownerId;
    } else if (ch === "discord") {
      const token = await askSecret(rl, "Discord bot token");
      if (token) envVars.DISCORD_BOT_TOKEN = token;
      channelConfig.config = { botToken: "$ENV{DISCORD_BOT_TOKEN}" };
      const ownerId = await ask(rl, "Your Discord user ID (snowflake)");
      if (ownerId) ownerChannels.discord = ownerId;
    } else if (ch === "gmail") {
      const clientId = await askSecret(rl, "Gmail client ID");
      if (clientId) envVars.GMAIL_CLIENT_ID = clientId;
      const clientSecret = await askSecret(rl, "Gmail client secret");
      if (clientSecret) envVars.GMAIL_CLIENT_SECRET = clientSecret;
      const refreshToken = await askSecret(rl, "Gmail refresh token");
      if (refreshToken) envVars.GMAIL_REFRESH_TOKEN = refreshToken;
      channelConfig.config = {
        clientId: "$ENV{GMAIL_CLIENT_ID}",
        clientSecret: "$ENV{GMAIL_CLIENT_SECRET}",
        refreshToken: "$ENV{GMAIL_REFRESH_TOKEN}",
      };
      const ownerEmail = await ask(rl, "Your email address");
      if (ownerEmail) ownerChannels.gmail = ownerEmail;
    } else if (ch === "signal") {
      const apiUrl = await ask(
        rl,
        "Signal CLI REST API URL",
        "http://localhost:8080",
      );
      envVars.SIGNAL_API_URL = apiUrl;
      channelConfig.config = { apiUrl: "$ENV{SIGNAL_API_URL}" };
      const ownerPhone = await ask(rl, "Your Signal phone number (+E.164)");
      if (ownerPhone) ownerChannels.signal = ownerPhone;
    } else if (ch === "whatsapp") {
      const token = await askSecret(rl, "WhatsApp access token");
      if (token) envVars.WHATSAPP_ACCESS_TOKEN = token;
      const phoneId = await ask(rl, "WhatsApp phone number ID");
      if (phoneId) envVars.WHATSAPP_PHONE_NUMBER_ID = phoneId;
      channelConfig.config = {
        accessToken: "$ENV{WHATSAPP_ACCESS_TOKEN}",
        phoneNumberId: "$ENV{WHATSAPP_PHONE_NUMBER_ID}",
      };
      const ownerPhone = await ask(rl, "Your WhatsApp number (+E.164)");
      if (ownerPhone) ownerChannels.whatsapp = ownerPhone;
    }

    channels.push(channelConfig);
  }

  config.channels = channels;
  (config.owner as Record<string, unknown>).channels = ownerChannels;
  console.log();

  // -- Phase 6: Optional features ----------------------------------------
  console.log(bold("  Optional Features"));

  const enableHosting = await askYesNo(rl, "Enable project hosting?", false);
  if (enableHosting) {
    const lanIp = await ask(rl, "LAN IP address", "192.168.0.144");
    const baseDomain = await ask(rl, "Base domain", "ai.on");
    config.hosting = { enabled: true, lanIp, baseDomain };
  }

  const enableVoice = await askYesNo(rl, "Enable voice pipeline (STT/TTS)?", false);
  if (enableVoice) {
    config.voice = { enabled: true };
  }

  const enableDashboardAuth = await askYesNo(
    rl,
    "Enable dashboard authentication?",
    false,
  );
  if (enableDashboardAuth) {
    const jwtSecret = randomBytes(32).toString("hex");
    envVars.JWT_SECRET = jwtSecret;
    config.dashboardAuth = {
      enabled: true,
      jwtSecret: "$ENV{JWT_SECRET}",
    };
    console.log(dim("  Generated JWT_SECRET (saved to .env)"));
  }

  console.log();

  // -- Phase 7: Workspace ------------------------------------------------
  console.log(bold("  Workspace"));
  const existingWs = (existing.workspace as Record<string, unknown>) ?? {};

  const workspaceRoot = await ask(
    rl,
    "Workspace root",
    (existingWs.root as string) ?? ".",
  );
  const projectDirs = await ask(
    rl,
    "Project directories (comma-separated, or empty)",
    ((existingWs.projects as string[]) ?? []).join(", "),
  );

  config.workspace = {
    root: workspaceRoot,
    projects: projectDirs
      ? projectDirs.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
  };

  // Carry over selfRepo if it existed
  if (existingWs.selfRepo) {
    (config.workspace as Record<string, unknown>).selfRepo =
      existingWs.selfRepo;
  }

  console.log();

  // -- Defaults for sections not prompted --------------------------------
  config.entities = (existing.entities as Record<string, unknown>) ?? {
    path: "./data/entities.db",
  };
  config.logging = (existing.logging as Record<string, unknown>) ?? {
    level: "info",
  };

  return { config, envVars };
}

// ---------------------------------------------------------------------------
// Phase 8: Generate files
// ---------------------------------------------------------------------------

async function generateFiles(
  ctx: SetupContext,
  result: SetupResult,
): Promise<void> {
  // Validate config against Zod schema (with mock env vars so $ENV{} refs pass)
  const mockEnv = { ...process.env, ...result.envVars };
  const originalEnv = process.env;
  try {
    process.env = mockEnv;
    const { resolveEnvRefs } = await import("../config-loader.js");
    const resolved = resolveEnvRefs(result.config);
    const validation = AionimaConfigSchema.safeParse(resolved);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("\n    ");
      console.log(yellow(`  Config validation warnings:\n    ${issues}`));
      console.log(dim("  (Writing anyway — you can fix these later)"));
      console.log();
    }
  } finally {
    process.env = originalEnv;
  }

  // Write aionima.json
  const configPath = resolve(ctx.targetDir, "aionima.json");
  const configJson = JSON.stringify(result.config, null, 2) + "\n";
  await writeFile(configPath, configJson, "utf-8");
  console.log(green(`  Written: ${configPath}`));

  // Write .env
  const envPath = resolve(ctx.targetDir, ".env");
  const envLines = [
    "# Aionima environment — secrets (mode 0600)",
    `# Generated by \`aionima setup\` on ${new Date().toISOString().split("T")[0]}`,
    "",
  ];

  for (const [key, value] of Object.entries(result.envVars)) {
    envLines.push(`${key}=${value}`);
  }

  envLines.push(""); // trailing newline

  // If .env exists, merge: keep existing vars, add new ones
  if (existsSync(envPath)) {
    const existingEnv = await readFile(envPath, "utf-8");
    const existingVars = new Set<string>();

    for (const line of existingEnv.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match) existingVars.add(match[1]!);
    }

    const newVars = Object.entries(result.envVars).filter(
      ([k]) => !existingVars.has(k),
    );

    if (newVars.length > 0) {
      const appendLines = [
        "",
        `# Added by aionima setup (${new Date().toISOString().split("T")[0]})`,
        ...newVars.map(([k, v]) => `${k}=${v}`),
        "",
      ];
      await writeFile(envPath, existingEnv.trimEnd() + "\n" + appendLines.join("\n"), "utf-8");
      console.log(green(`  Updated: ${envPath} (${String(newVars.length)} new vars)`));
    } else {
      console.log(dim(`  Skipped: ${envPath} (all vars already present)`));
    }
  } else {
    // Ensure parent directory exists
    const envDir = dirname(envPath);
    if (!existsSync(envDir)) {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(envDir, { recursive: true });
    }
    await writeFile(envPath, envLines.join("\n"), "utf-8");
    console.log(green(`  Written: ${envPath}`));
  }

  // Set .env permissions to 0600
  await chmod(envPath, 0o600);
  console.log(dim("  Set .env permissions to 0600"));
}

// ---------------------------------------------------------------------------
// Phase 9: Post-setup
// ---------------------------------------------------------------------------

function printPostSetup(ctx: SetupContext): void {
  console.log();
  console.log(bold("  Setup complete!"));
  console.log();
  console.log(`  ${dim("Config:")} ${resolve(ctx.targetDir, "aionima.json")}`);
  console.log(`  ${dim("Secrets:")} ${resolve(ctx.targetDir, ".env")}`);
  console.log();
  console.log(`  ${cyan("Next steps:")}`);

  if (ctx.isDeployDir) {
    console.log(`    1. Review config:  ${dim("cat aionima.json")}`);
    console.log(`    2. Start service:  ${dim("sudo systemctl start aionima")}`);
    console.log(`    3. Check health:   ${dim("aionima doctor")}`);
  } else {
    console.log(`    1. Review config:  ${dim("cat aionima.json")}`);
    console.log(`    2. Start locally:  ${dim("aionima run")}`);
    console.log(`    3. Check health:   ${dim("aionima doctor")}`);
    console.log();
    console.log(
      dim(
        "  For production deployment, run install.sh or deploy.sh to sync to /opt/aionima",
      ),
    );
  }

  console.log();
}
