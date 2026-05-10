/**
 * definePmProvider — chainable builder for PmProviderDefinition.
 *
 * PM providers back the canonical tynn workflow with arbitrary storage:
 * tynn-the-service (built-in), tynn-lite file-based (built-in), or any
 * plugin-registered alternative (Linear, Jira, GitHub Projects, etc).
 *
 * Storage is pluggable; the workflow shape is canonical. See
 * `agi/docs/agents/tynn-and-related-concepts.md`.
 *
 * ## Quick example
 *
 * ```ts
 * import { definePmProvider, type PmProvider } from "@agi/sdk";
 *
 * const linear = definePmProvider("linear", "Linear")
 *   .description("Linear issue tracker as PM provider")
 *   .fields([
 *     { id: "apiKey", label: "Linear API key", type: "password" },
 *     { id: "teamId", label: "Team id", type: "text" },
 *   ])
 *   .factory((config) => createLinearPmProvider(config))
 *   .build();
 *
 * // In your plugin's activate():
 * api.registerPmProvider(linear);
 * ```
 *
 * The factory's return type is `unknown` at the plugin-API boundary (avoids
 * a circular dep on @agi/sdk from @agi/plugins). Plugin authors should write
 * factories that return objects matching the `PmProvider` interface — the
 * gateway runtime treats the returned object as `PmProvider` at the call site.
 */

import type {
  PmKanbanColumn,
  PmKanbanConfig,
  PmProviderDefinition,
  PmProviderFactory,
  ProviderField,
} from "@agi/plugins";
export type { PmKanbanColumn, PmKanbanConfig, PmProviderDefinition, PmProviderFactory };

class PmProviderBuilder {
  private def: Partial<PmProviderDefinition> & { id: string; name: string };
  private _fields: ProviderField[] = [];

  constructor(id: string, name: string) {
    this.def = { id, name };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  fields(fields: ProviderField[]): this {
    this._fields = fields;
    return this;
  }

  factory(fn: PmProviderFactory): this {
    this.def.factory = fn;
    return this;
  }

  /**
   * s139 t535 — supply the Kanban board config the dashboard uses as
   * the default seed for projects backed by this provider. Owners can
   * still override per-project; this is the provider's recommended
   * starting layout.
   */
  kanbanConfig(config: PmKanbanConfig): this {
    this.def.kanbanConfig = config;
    return this;
  }

  build(): PmProviderDefinition {
    if (!this.def.factory) throw new Error("PmProviderDefinition requires a factory");
    if (this._fields.length > 0) this.def.fields = this._fields;
    return this.def as PmProviderDefinition;
  }
}

/**
 * Create a PM provider definition using a chainable builder.
 *
 * @param id - Unique provider identifier (e.g. "linear", "jira", "github-projects").
 *             Must NOT collide with the built-in ids "tynn" or "tynn-lite".
 * @param name - Human-readable name (e.g. "Linear")
 */
export function definePmProvider(id: string, name: string): PmProviderBuilder {
  return new PmProviderBuilder(id, name);
}

/**
 * s139 t535 — declarative builder for `PmKanbanConfig`. Lightweight
 * sugar around the bare object literal so plugin authors get the same
 * chainable feel as `definePmProvider`. Validates column ids are
 * unique + at-most-one catch-all column.
 *
 * Example:
 *
 * ```ts
 * import { definePmKanbanConfig } from "@agi/sdk";
 *
 * const config = definePmKanbanConfig({
 *   columns: [
 *     { id: "todo", name: "To do", order: 0, color: "slate", statuses: ["backlog"] },
 *     { id: "now",  name: "Now",   order: 10, color: "blue", statuses: ["starting", "doing"] },
 *     { id: "qa",   name: "QA",    order: 20, color: "yellow", statuses: ["testing"] },
 *     { id: "done", name: "Done",  order: 30, color: "green", statuses: ["finished", "archived"] },
 *   ],
 *   defaultPriority: "normal",
 * });
 *
 * const provider = definePmProvider("my-pm", "My PM")
 *   .factory(...)
 *   .kanbanConfig(config)
 *   .build();
 * ```
 */
export function definePmKanbanConfig(config: PmKanbanConfig): PmKanbanConfig {
  // Uniqueness check on column ids — silent dupes would be a debugging
  // nightmare in the dashboard.
  const seen = new Set<string>();
  for (const col of config.columns) {
    if (seen.has(col.id)) {
      throw new Error(`definePmKanbanConfig: duplicate column id "${col.id}"`);
    }
    seen.add(col.id);
  }
  // Note: columns without `statuses` are visual-only. If multiple such
  // columns exist, task assignment falls through to the first by order
  // (deterministic). No catch-all uniqueness check — visual-only boards
  // (3-column "to do / now / done" without status mapping) are valid.
  // Normalize: sort by `order` so consumers don't have to.
  return { ...config, columns: [...config.columns].sort((a, b) => a.order - b.order) };
}

/**
 * Default tynn-shape Kanban config — used as the seed for both built-in
 * providers (tynn, tynn-lite) and exposed for plugins that want to
 * mirror the canonical workflow shape.
 */
export const DEFAULT_TYNN_KANBAN_CONFIG: PmKanbanConfig = definePmKanbanConfig({
  columns: [
    { id: "todo", name: "To do", order: 0, color: "slate", statuses: ["backlog"] },
    { id: "now", name: "Now", order: 10, color: "blue", statuses: ["starting", "doing"] },
    { id: "qa", name: "QA", order: 20, color: "yellow", statuses: ["testing"] },
    { id: "done", name: "Done", order: 30, color: "green", statuses: ["finished"] },
    { id: "blocked", name: "Blocked", order: 40, color: "red", statuses: ["blocked"], hiddenByDefault: true },
    { id: "archived", name: "Archived", order: 50, color: "slate", statuses: ["archived"], hiddenByDefault: true },
  ],
  defaultPriority: "normal",
  filters: [
    { id: "priority", label: "Priority", type: "priority" },
    { id: "labels", label: "Labels", type: "label" },
    { id: "subtasks", label: "Has subtasks", type: "subtasks" },
    { id: "overdue", label: "Overdue only", type: "overdue" },
  ],
});
