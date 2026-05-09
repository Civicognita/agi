/**
 * `aionima run` — Start the gateway system.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config-loader.js";
import { bold, cyan, dim, formatState } from "../output.js";
import { startGatewayServer } from "@agi/gateway-core";

/** Auto-detect dashboard dist directory relative to project root. */
function findDashboardDir(): string | undefined {
  const candidates = [
    resolve("ui/dashboard/dist"),
    resolve("dashboard/dist"),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "index.html"))) return dir;
  }
  return undefined;
}

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Start the aionima gateway")
    .action(async () => {
      const opts = program.opts<{ config?: string }>();

      let config;
      let configPath: string | undefined;
      try {
        const result = await loadConfig(opts.config);
        config = result.config;
        configPath = resolve(result.path);
        console.log(dim(`Config loaded from ${result.path}`));
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      const gw = config.gateway ?? { host: "127.0.0.1", port: 3100, state: "OFFLINE" as const };
      const staticDir = findDashboardDir();

      console.log();
      console.log(bold("  aionima gateway"));
      console.log(`  ${dim("listen")}    ${cyan(`${gw.host}:${String(gw.port)}`)}`);
      console.log(`  ${dim("state")}     ${formatState(gw.state)}`);
      console.log(`  ${dim("channels")}  ${String(config.channels.length)} configured`);
      console.log(`  ${dim("dashboard")} ${staticDir !== undefined ? cyan(`http://${gw.host}:${String(gw.port)}`) : dim("not built (run: pnpm --filter @agi/dashboard build)")}`);
      console.log();

      let server;
      try {
        server = await startGatewayServer(config, {
          configPath,
          staticDir,
        });
      } catch (err) {
        console.error(
          `Error starting gateway: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Hard exit — `process.exitCode = 1; return;` left the process alive
        // when DB pools / file watchers / half-initialized Fastify held open
        // handles, causing systemd self-heal to never fire. Force exit so
        // systemd restarts the unit cleanly.
        process.exit(1);
      }

      // Graceful shutdown on SIGINT / SIGTERM
      const shutdown = (): void => {
        console.log(dim("\n  Shutting down..."));
        server.close().then(() => {
          process.exit(0);
        }).catch((err: unknown) => {
          console.error(
            `Error during shutdown: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        });
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Keep the process alive — the gateway servers hold open handles
    });
}
