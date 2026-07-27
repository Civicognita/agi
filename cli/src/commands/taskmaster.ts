/**
 * `agi taskmaster` — Taskmaster job status.
 *
 * Prints a one-shot job listing (optionally scoped to one project via
 * `--project`, or `--json`). Interactive control (dispatch, checkpoint
 * approve/reject) happens through conversation with Aion in `agi chat`,
 * not a dedicated TUI screen.
 */

import type { Command } from "commander";
import { GatewayClient, GatewayUnreachableError } from "../gateway-client.js";
import { bold, red } from "../output.js";

export function registerTaskmasterCommand(program: Command): void {
  program
    .command("taskmaster")
    .description("Taskmaster job status")
    .option("--project <path>", "Scope to one project's jobs (absolute path)")
    .option("--json", "Output as JSON")
    .action(async (cmdOpts: { project?: string; json?: boolean }) => {
      const opts = program.opts<{ host?: string; port?: number }>();
      const client = new GatewayClient(opts.host ?? "127.0.0.1", opts.port ?? 3100);

      try {
        const jobs = await client.taskmasterJobs(cmdOpts.project);

        if (cmdOpts.json) {
          console.log(JSON.stringify(jobs, null, 2));
          return;
        }

        console.log();
        console.log(bold(`  Taskmaster jobs${cmdOpts.project ? ` — ${cmdOpts.project}` : ""}`));
        console.log();
        if (jobs.length === 0) {
          console.log("  No jobs.");
        } else {
          for (const job of jobs) {
            console.log(`  ${job.id}  [${job.status}]  ${job.description}`);
          }
        }
        console.log();
      } catch (err) {
        if (err instanceof GatewayUnreachableError) {
          console.error(red(err.message));
          process.exitCode = 1;
          return;
        }
        throw err;
      } finally {
        // A fetch() call anywhere in this process (pre-existing behavior —
        // also affects `agi doctor --with-aion`) leaves the event loop alive
        // after this one-shot command's work is genuinely done. Exit
        // explicitly rather than have every invocation hang until killed.
        process.exit(process.exitCode ?? 0);
      }
    });
}
