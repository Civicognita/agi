/**
 * `agi chat` — interactive terminal chat with Aion.
 *
 * Modeled on Claude Code itself: the folder the command is launched in is
 * the "Chat Container" (not a picker over registered `/api/projects`),
 * full owner-tier access (same as the dashboard's chat), and — if the
 * container is (or sits inside) an `.agi` envelope — the server folds in
 * that envelope's loop-state as context. See `docs/agents/chat-tui.md`.
 *
 * The full-window layout (`../chat-tui/App.tsx`, built on
 * `@particle-academy/fancy-tui`) is the default when stdin is a real
 * terminal. Piped/non-interactive invocation (scripting, CI, `agi chat <
 * /dev/null`) falls back to the original plain-text readline REPL below —
 * Ink can't render its full-screen layout without a real TTY.
 */

import type { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { existsSync, statSync, createWriteStream } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { render } from "ink";
import { createElement } from "react";
import { ChatClient, ChatWsUnreachableError, ChatTurnError, ChatTimeoutError, type ChatClientOptions, type ChatDebugEvent, type ChatToolStartEvent, type ChatToolResultEvent } from "../chat-client.js";
import { GatewayClient } from "../gateway-client.js";
import { App } from "../chat-tui/App.js";
import { bold, dim, red } from "../output.js";

/** How often to remind the user a turn is still running (and how to cancel) while waiting — readline fallback only. */
const STILL_WAITING_REMINDER_MS = 20_000;

/** How many parent directories to check for an `.agi` envelope root — mirrors gateway-core's own readAgiEnvelopeContext search depth. Purely cosmetic here (a startup banner); the gateway does its own detection for system-prompt context. */
const AGI_ENVELOPE_SEARCH_DEPTH = 4;

export function detectAgiEnvelope(startPath: string): string | null {
  let dir = startPath;
  for (let i = 0; i < AGI_ENVELOPE_SEARCH_DEPTH; i++) {
    try {
      if (statSync(join(dir, "project.json")).isFile() && statSync(join(dir, ".ai")).isDirectory()) {
        return dir;
      }
    } catch {
      // not an envelope root — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

interface ChatCommandOptions {
  containerPath: string;
  envelopeRoot: string | null;
  chatClientOptions: ChatClientOptions;
  quiet: boolean;
  /** A saved session to resume (its history hydrates into the transcript) instead of starting fresh. Resolved in `registerChatCommand` — either explicit (`--session`) or auto-picked as the most recently updated session whose `context` matches this container path. */
  resumeSessionId?: string;
}

/** Enter/exit the terminal's alternate screen buffer — the same mechanism vim/htop/less use for a full-terminal takeover (a blank canvas exactly the size of the terminal; the prior shell scrollback is preserved underneath and restored on exit). Ink's `render()` has no notion of this on its own — by default it just starts printing wherever the cursor already sits. */
const ENTER_ALT_SCREEN = "[?1049h";
const EXIT_ALT_SCREEN = "[?1049l";

async function runInkChat(opts: ChatCommandOptions): Promise<void> {
  if (process.stdout.isTTY) {
    process.stdout.write(ENTER_ALT_SCREEN);
  }
  try {
    const { waitUntilExit } = render(
      createElement(App, {
        containerPath: opts.containerPath,
        envelopeRoot: opts.envelopeRoot,
        chatClientOptions: opts.chatClientOptions,
        quiet: opts.quiet,
        resumeSessionId: opts.resumeSessionId,
      }),
    );
    await waitUntilExit();
  } finally {
    if (process.stdout.isTTY) {
      process.stdout.write(EXIT_ALT_SCREEN);
    }
  }
  // See the readline fallback's comment below — a persistent WS connection
  // anywhere in this process leaves the event loop alive after the app
  // genuinely exits. Exit explicitly.
  process.exit(0);
}

async function runReadlineChat(opts: ChatCommandOptions): Promise<void> {
  const { containerPath, envelopeRoot, chatClientOptions, quiet } = opts;
  console.log();
  console.log(`${bold("agi chat")} ${dim(`— ${containerPath}`)}`);
  if (envelopeRoot !== null) {
    console.log(dim(`.agi envelope detected at ${envelopeRoot}`));
  }
  console.log(dim("(non-interactive stdin — plain-text mode. /quit or Ctrl-C to exit)"));
  if (opts.resumeSessionId !== undefined) {
    console.log(dim(`Resuming session ${opts.resumeSessionId}`));
  }
  console.log();

  const sendTimeoutMs = chatClientOptions.sendTimeoutMs ?? 120_000;
  const client = new ChatClient(chatClientOptions);
  client.on({
    onThinking: () => { if (!quiet) process.stdout.write(dim("  …thinking\n")); },
    onToolStart: (e: ChatToolStartEvent) => { if (!quiet) process.stdout.write(dim(`  → ${e.toolName}\n`)); },
    onToolResult: (e: ChatToolResultEvent) => { if (!quiet) process.stdout.write(dim(`  ${e.success ? "✓" : "✗"} ${e.toolName}: ${e.summary}\n`)); },
    onProgress: (e) => { if (!quiet) process.stdout.write(dim(`  ${e.text}\n`)); },
    onThought: (content) => { if (!quiet) process.stdout.write(dim(`  ${content.length > 200 ? `${content.slice(0, 200)}…` : content}\n`)); },
    onUnsolicitedResponse: (text) => process.stdout.write(`\n${bold("Aion:")} ${text}\n\n`),
    onClosed: () => console.log(dim("\nConnection closed.")),
  });

  try {
    await client.open(containerPath, opts.resumeSessionId);
  } catch (err) {
    if (err instanceof ChatWsUnreachableError) {
      console.error(red(err.message));
    } else {
      console.error(red(err instanceof Error ? err.message : String(err)));
    }
    process.exitCode = 1;
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let exiting = false;
  const onSigint = () => {
    if (exiting) return;
    exiting = true;
    client.cancel();
    rl.close();
  };
  process.on("SIGINT", onSigint);

  try {
    while (!exiting) {
      let line: string;
      try {
        line = await rl.question("> ");
      } catch {
        break; // EOF / Ctrl-D / Ctrl-C during the prompt itself
      }
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (trimmed === "/quit" || trimmed === "/exit") break;

      const reminder = setInterval(() => {
        console.log(dim(`  …still waiting (Ctrl-C to cancel, or it'll time out after ${String(sendTimeoutMs / 1000)}s)`));
      }, STILL_WAITING_REMINDER_MS);

      try {
        const text = await client.send(trimmed);
        console.log();
        console.log(`${bold("Aion:")} ${text}`);
        console.log();
      } catch (err) {
        if (err instanceof ChatTimeoutError) {
          console.log(red(`Timed out: ${err.message}`));
        } else if (err instanceof ChatTurnError) {
          console.log(red(`Error: ${err.message}`));
        } else {
          console.log(red(err instanceof Error ? err.message : String(err)));
        }
      } finally {
        clearInterval(reminder);
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
    client.close();
    // A persistent connection anywhere in this process (WS here, fetch()
    // elsewhere) leaves the event loop alive after the REPL genuinely
    // exits. Exit explicitly.
    process.exit(process.exitCode ?? 0);
  }
}

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Interactive chat with Aion — full owner-tier access, scoped to the current folder")
    .option("--cwd <path>", "Container folder (defaults to the current directory)")
    .option("--quiet", "Suppress intermediate activity (thinking/tool/progress lines) — just show Aion's final response")
    .option("--timeout <seconds>", "Max time to wait for a turn before giving up locally (default 120)", "120")
    .option("--debug <path>", "Stream every WS send/receive + connection-lifecycle event to this file as JSONL (for diagnosing a stuck or misbehaving turn)")
    .option("--session <id>", "Resume this specific saved session by id, instead of auto-resuming the container's most recent one")
    .option("--new-session", "Start fresh even if a prior session exists for this container")
    .action(async (cmdOpts: { cwd?: string; quiet?: boolean; timeout?: string; debug?: string; session?: string; newSession?: boolean }) => {
      const opts = program.opts<{ host?: string; port?: number }>();
      const sendTimeoutMs = Math.max(1, Number(cmdOpts.timeout) || 120) * 1000;

      let debugSink: ((event: ChatDebugEvent) => void) | undefined;
      if (cmdOpts.debug !== undefined) {
        const debugPath = resolve(cmdOpts.debug);
        const debugStream = createWriteStream(debugPath, { flags: "a" });
        debugSink = (event) => { debugStream.write(`${JSON.stringify(event)}\n`); };
        console.log(dim(`(debug log: ${debugPath})`));
      }
      // scripts/agi-cli.sh's `chat` route `cd`s into the dev source tree
      // before exec-ing this file, so `process.cwd()` alone would always
      // resolve to that tree rather than wherever the user actually ran
      // `agi chat` — it sets AGI_CHAT_CALLER_CWD beforehand to preserve
      // the real caller directory. Direct dev invocation (no wrapper) has
      // no `cd`, so plain `process.cwd()` is already correct there.
      const containerPath = cmdOpts.cwd
        ? resolve(cmdOpts.cwd)
        : (process.env.AGI_CHAT_CALLER_CWD ?? process.cwd());

      if (!existsSync(containerPath)) {
        console.error(red(`Container folder does not exist: ${containerPath}`));
        process.exitCode = 1;
        process.exit(1);
      }

      // Workspace-scoped session resume: an explicit --session id wins;
      // otherwise auto-pick the most recently updated saved session whose
      // `context` matches this exact container path. A gateway that's
      // unreachable (or too old to have this endpoint) just falls through
      // to a fresh session — the WS open() below surfaces the real error
      // if the gateway is genuinely down, so failing silently here is safe.
      let resumeSessionId: string | undefined = cmdOpts.session;
      if (resumeSessionId === undefined && cmdOpts.newSession !== true) {
        try {
          const gatewayClient = new GatewayClient(opts.host ?? "127.0.0.1", opts.port ?? 3100);
          const sessions = await gatewayClient.chatSessions();
          const matches = sessions
            .filter((s) => s.context === containerPath)
            .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          resumeSessionId = matches[0]?.id;
        } catch {
          // Unreachable gateway or missing endpoint — proceed with a fresh session.
        }
      }

      const commandOpts: ChatCommandOptions = {
        containerPath,
        envelopeRoot: detectAgiEnvelope(containerPath),
        chatClientOptions: { host: opts.host ?? "127.0.0.1", port: opts.port ?? 3100, sendTimeoutMs, debugSink },
        quiet: cmdOpts.quiet === true,
        resumeSessionId,
      };

      if (process.stdin.isTTY === true) {
        await runInkChat(commandOpts);
      } else {
        await runReadlineChat(commandOpts);
      }
    });
}
