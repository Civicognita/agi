/**
 * `aionima config` — Config validation and display.
 */

import type { Command } from "commander";
import { loadConfig, validateConfigFile } from "../config-loader.js";
import { bold, dim, green, red } from "../output.js";

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Configuration management");

  config
    .command("validate")
    .description("Validate the config file")
    .action(async () => {
      const opts = program.opts<{ config?: string }>();
      const result = await validateConfigFile(opts.config);

      console.log();
      console.log(bold("  Config Validation"));
      console.log();
      console.log(`  ${dim("File:")} ${result.path}`);
      console.log();

      if (result.errors === null) {
        console.log(`  ${green("✓ Valid configuration")}`);
      } else {
        console.log(`  ${red("✗ Invalid configuration:")}`);
        for (const err of result.errors) {
          console.log(`    ${red("•")} ${err}`);
        }
        process.exitCode = 1;
      }
      console.log();
    });

  config
    .command("show")
    .description("Show resolved configuration")
    .action(async () => {
      const opts = program.opts<{ config?: string }>();

      try {
        const result = await loadConfig(opts.config);

        console.log();
        console.log(bold("  Resolved Configuration"));
        console.log(`  ${dim("Source:")} ${result.path}`);
        console.log();
        console.log(dim(JSON.stringify(result.config, null, 2)));
        console.log();
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });
}
