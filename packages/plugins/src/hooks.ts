/**
 * Hook bus — dispatches lifecycle events to registered plugin handlers.
 * Adapted from OpenClaw's hook system.
 */

import type { AionimaHookMap } from "./types.js";

type HookHandler = (...args: unknown[]) => Promise<unknown>;

interface TaggedHandler {
  pluginId?: string;
  handler: HookHandler;
}

export class HookBus {
  private readonly handlers = new Map<string, TaggedHandler[]>();

  register<K extends keyof AionimaHookMap>(hook: K, handler: AionimaHookMap[K], pluginId?: string): void {
    const key = hook as string;
    const existing = this.handlers.get(key) ?? [];
    existing.push({ pluginId, handler: handler as HookHandler });
    this.handlers.set(key, existing);
  }

  async dispatch<K extends keyof AionimaHookMap>(
    hook: K,
    ...args: Parameters<AionimaHookMap[K]>
  ): Promise<void> {
    const key = hook as string;
    const handlerList = this.handlers.get(key);
    if (!handlerList) return;
    for (const entry of handlerList) {
      await entry.handler(...args);
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
    for (const entry of handlerList) {
      const result = await entry.handler(current, ...rest);
      if (result !== undefined) {
        current = result as Parameters<AionimaHookMap[K]>[0];
      }
    }
    return current;
  }

  getRegisteredHooks(): string[] {
    return Array.from(this.handlers.keys());
  }

  removeForPlugin(pluginId: string): number {
    let removed = 0;
    for (const [key, handlers] of this.handlers) {
      const before = handlers.length;
      const filtered = handlers.filter(h => h.pluginId !== pluginId);
      if (filtered.length < before) {
        this.handlers.set(key, filtered);
        removed += before - filtered.length;
      }
    }
    return removed;
  }

  clear(): void {
    this.handlers.clear();
  }
}
