/**
 * ActionExecutor — dispatches plugin-registered actions (shell, api, hook).
 */

import { execFile } from "node:child_process";
import type { PluginRegistry } from "@aionima/plugins";
import type { HookBus } from "@aionima/plugins";

export interface ActionExecResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export async function executeAction(
  actionId: string,
  context: Record<string, string>,
  deps: { pluginRegistry: PluginRegistry; hookBus: HookBus },
): Promise<ActionExecResult> {
  const registered = deps.pluginRegistry.getActions().find((a) => a.action.id === actionId);
  if (!registered) {
    return { ok: false, error: `Action not found: ${actionId}` };
  }

  const { handler } = registered.action;

  switch (handler.kind) {
    case "shell": {
      const cwd = handler.cwd ?? context.projectPath ?? process.cwd();
      return new Promise<ActionExecResult>((resolve) => {
        execFile("bash", ["-c", handler.command], { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
          if (err) {
            resolve({ ok: false, output: stdout, error: stderr || err.message });
          } else {
            resolve({ ok: true, output: stdout });
          }
        });
      });
    }

    case "api": {
      try {
        const method = handler.method ?? "GET";
        const url = handler.endpoint.startsWith("http")
          ? handler.endpoint
          : `http://127.0.0.1:${process.env.PORT ?? 3124}${handler.endpoint}`;
        const init: RequestInit = { method };
        if (handler.body) {
          init.headers = { "Content-Type": "application/json" };
          init.body = JSON.stringify(handler.body);
        }
        const res = await fetch(url, init);
        const text = await res.text();
        return { ok: res.ok, output: text };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "hook": {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (deps.hookBus as any).dispatch(handler.hookName, handler.payload);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
}
