/**
 * Hook bus — dispatches lifecycle events to registered plugin handlers.
 * Adapted from OpenClaw's hook system.
 */

import type { AionimaHookMap } from "./types.js";

type HookHandler = (...args: unknown[]) => Promise<unknown>;

export class HookBus {
  private readonly handlers = new Map<string, HookHandler[]>();

  register<K extends keyof AionimaHookMap>(hook: K, handler: AionimaHookMap[K]): void {
    const key = hook as string;
    const existing = this.handlers.get(key) ?? [];
    existing.push(handler as HookHandler);
    this.handlers.set(key, existing);
  }

  async dispatch<K extends keyof AionimaHookMap>(
    hook: K,
    ...args: Parameters<AionimaHookMap[K]>
  ): Promise<void> {
    const key = hook as string;
    const handlerList = this.handlers.get(key);
    if (!handlerList) return;

    for (const handler of handlerList) {
      await handler(...args);
    }
  }

  async dispatchWaterfall<K extends keyof AionimaHookMap>(
    hook: K,
    initial: Parameters<AionimaHookMap[K]>[0],
    ...rest: unknown[]
  ): Promise<Parameters<AionimaHookMap[K]>[0]> {
    const key = hook as string;
    const handlerList = this.handlers.get(key);
    if (!handlerList) return initial;

    let current = initial;
    for (const handler of handlerList) {
      const result = await handler(current, ...rest);
      if (result !== undefined) {
        current = result as Parameters<AionimaHookMap[K]>[0];
      }
    }
    return current;
  }

  getRegisteredHooks(): string[] {
    return Array.from(this.handlers.keys());
  }

  clear(): void {
    this.handlers.clear();
  }
}
