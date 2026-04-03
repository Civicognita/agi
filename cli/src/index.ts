#!/usr/bin/env node

/**
 * aionima CLI — 0R Gateway management interface.
 */

import { Command } from "commander";
import { registerRunCommand } from "./commands/run.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerChannelsCommand } from "./commands/channels.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerSetupCommand } from "./commands/setup.js";

const program = new Command();

program
  .name("aionima")
  .description("0R Gateway — personal AI assistant with impactinomics")
  .version("0.1.0")
  .option("-c, --config <path>", "Path to config file")
  .option("--host <host>", "Gateway host", "127.0.0.1")
  .option("--port <port>", "Gateway port", "3100")
  .option("-v, --verbose", "Enable verbose output")
  .option("-q, --quiet", "Suppress non-essential output");

registerRunCommand(program);
registerStatusCommand(program);
registerDoctorCommand(program);
registerChannelsCommand(program);
registerConfigCommand(program);
registerSetupCommand(program);

program.parse();
