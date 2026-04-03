/**
 * `aionima status` — Show gateway state and key metrics.
 */

import type { Command } from "commander";
import { GatewayClient, GatewayUnreachableError } from "../gateway-client.js";
import { bold, formatState, printStatus, red } from "../output.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show gateway state and metrics")
    .action(async () => {
      const opts = program.opts<{ config?: string; host?: string; port?: number }>();
      const host = opts.host ?? "127.0.0.1";
      const port = opts.port ?? 3100;

      const client = new GatewayClient(host, port);

      try {
        const s = await client.status();

        console.log();
        console.log(bold("  aionima status"));
        console.log();

        printStatus([
          { label: "State", value: formatState(s.state) },
          { label: "Uptime", value: formatUptime(s.uptime) },
          { label: "Channels", value: String(s.channels.length) },
          { label: "Entities", value: String(s.entities) },
          { label: "Queue Depth", value: String(s.queueDepth) },
          { label: "WS Clients", value: String(s.connections) },
        ]);

        console.log();
      } catch (err) {
        if (err instanceof GatewayUnreachableError) {
          console.error(red(err.message));
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${String(Math.floor(seconds))}s`;
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m ${String(Math.floor(seconds % 60))}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h)}h ${String(m)}m`;
}
