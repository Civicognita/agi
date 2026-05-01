#!/usr/bin/env node

/**
 * Aionima gateway server entry point.
 *
 * This is NOT the user-facing CLI — use the `agi` command for that.
 * This file only registers the `run` command (starts the gateway server)
 * and `setup` (interactive config wizard, called via `agi setup`).
 *
 * All other commands (status, logs, upgrade, restart, doctor, config,
 * projects, channels) live in scripts/agi-cli.sh.
 */

import { Command } from "commander";
import { registerRunCommand } from "./commands/run.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerChannelsCommand } from "./commands/channels.js";
import { registerSchemaCommand } from "./commands/schema.js";

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

program.parse();
