#!/usr/bin/env node

/**
 * Aionima gateway server entry point.
 *
 * This is NOT the user-facing CLI — use the `agi` command for that.
 * `scripts/agi-cli.sh` is the real dispatcher; it execs into this file
 * (via `npx tsx cli/src/index.ts <command> ...`) for the commander-based
 * subcommands registered below (run, setup, channels, schema, doctor,
 * taskmaster, chat) rather than reimplementing them in bash. Everything
 * else (status, logs, upgrade, restart, config, projects) is implemented
 * directly in scripts/agi-cli.sh.
 */

import { Command } from "commander";
import { registerRunCommand } from "./commands/run.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerChannelsCommand } from "./commands/channels.js";
import { registerSchemaCommand } from "./commands/schema.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerTaskmasterCommand } from "./commands/taskmaster.js";
import { registerChatCommand } from "./commands/chat.js";

const program = new Command();

program
  .name("aionima")
  .description("Aionima gateway server")
  .version("0.1.0")
  .option("-c, --config <path>", "Path to config file")
  .option("--host <host>", "Gateway host", "127.0.0.1")
  .option("--port <port>", "Gateway port", "3100")
  .option("-v, --verbose", "Enable verbose output")
  .option("-q, --quiet", "Suppress non-essential output");

registerRunCommand(program);
registerSetupCommand(program);
registerChannelsCommand(program);
registerSchemaCommand(program);
registerDoctorCommand(program);
registerTaskmasterCommand(program);
registerChatCommand(program);

program.parse();
