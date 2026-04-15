/**
 * `aionima channels` — Channel management subcommands.
 */

import type { Command } from "commander";
import { loadConfig } from "../config-loader.js";
import { bold, dim, green, printTable, yellow } from "../output.js";

export function registerChannelsCommand(program: Command): void {
  const channels = program
    .command("channels")
    .description("Manage channel adapters");

  channels
    .command("list")
    .description("List configured channels")
    .action(async () => {
      const opts = program.opts<{ config?: string }>();

      let config;
      try {
        const result = await loadConfig(opts.config);
        config = result.config;
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return;
      }

      console.log();
      console.log(bold("  Configured Channels"));
      console.log();

      if (config.channels.length === 0) {
        console.log(dim("  No channels configured."));
        console.log(dim("  Add one in gateway.json under \"channels\"."));
        console.log();
        return;
      }

      const rows = config.channels.map((ch) => [
        ch.id,
        ch.enabled ? green("enabled") : yellow("disabled"),
        ch.config ? dim("custom") : dim("default"),
      ]);

      printTable(["Channel", "Status", "Config"], rows);
      console.log();
    });

  channels
    .command("test <id>")
    .description("Send a test message through a channel")
    .action(async (id: string) => {
      console.log();
      console.log(dim(`  Test message for channel "${id}" — not yet wired (Phase 2)`));
      console.log();
    });
}
