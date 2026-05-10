/**
 * definePmKanbanConfig + .kanbanConfig() builder tests — s139 t535.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_TYNN_KANBAN_CONFIG,
  definePmKanbanConfig,
  definePmProvider,
} from "./define-pm-provider.js";

describe("definePmKanbanConfig (s139 t535)", () => {
  it("accepts a minimal config", () => {
    const c = definePmKanbanConfig({
      columns: [
        { id: "todo", name: "To do", order: 0 },
        { id: "done", name: "Done", order: 1 },
      ],
    });
    expect(c.columns).toHaveLength(2);
  });

  it("sorts columns by order ascending", () => {
    const c = definePmKanbanConfig({
      columns: [
        { id: "z", name: "Z", order: 30 },
        { id: "a", name: "A", order: 10 },
        { id: "m", name: "M", order: 20 },
      ],
    });
    expect(c.columns.map((col) => col.id)).toEqual(["a", "m", "z"]);
  });

  it("rejects duplicate column ids", () => {
    expect(() =>
      definePmKanbanConfig({
        columns: [
          { id: "x", name: "X", order: 0 },
          { id: "x", name: "X dup", order: 1 },
        ],
      }),
    ).toThrow(/duplicate column id/);
  });

  it("allows multiple visual-only columns (no statuses)", () => {
    // Visual-only boards (3-column "to do / now / done" without status
    // mapping) are valid. Assignment falls through to first-by-order.
    const c = definePmKanbanConfig({
      columns: [
        { id: "a", name: "A", order: 0 },
        { id: "b", name: "B", order: 1 },
      ],
    });
    expect(c.columns).toHaveLength(2);
  });

  it("allows a single column with statuses + a catch-all", () => {
    const c = definePmKanbanConfig({
      columns: [
        { id: "todo", name: "To do", order: 0, statuses: ["backlog"] },
        { id: "other", name: "Other", order: 1 }, // visual-only
      ],
    });
    expect(c.columns).toHaveLength(2);
  });

  it("preserves defaultPriority + labels + filters", () => {
    const c = definePmKanbanConfig({
      columns: [{ id: "x", name: "X", order: 0 }],
      defaultPriority: "high",
      labels: [{ id: "bug", name: "Bug", color: "red" }],
      filters: [{ id: "priority", label: "Priority", type: "priority" }],
    });
    expect(c.defaultPriority).toBe("high");
    expect(c.labels).toHaveLength(1);
    expect(c.filters).toHaveLength(1);
  });
});

describe("DEFAULT_TYNN_KANBAN_CONFIG (s139 t535)", () => {
  it("has 6 columns including hidden blocked + archived", () => {
    expect(DEFAULT_TYNN_KANBAN_CONFIG.columns).toHaveLength(6);
    const hidden = DEFAULT_TYNN_KANBAN_CONFIG.columns.filter((c) => c.hiddenByDefault);
    expect(hidden.map((c) => c.id).sort()).toEqual(["archived", "blocked"]);
  });

  it("buckets all PmStatus values into a column", () => {
    const allStatuses = new Set<string>();
    for (const c of DEFAULT_TYNN_KANBAN_CONFIG.columns) {
      for (const s of c.statuses ?? []) allStatuses.add(s);
    }
    expect(allStatuses).toContain("backlog");
    expect(allStatuses).toContain("starting");
    expect(allStatuses).toContain("doing");
    expect(allStatuses).toContain("testing");
    expect(allStatuses).toContain("finished");
    expect(allStatuses).toContain("blocked");
    expect(allStatuses).toContain("archived");
  });

  it("collapses starting + doing into the Now column", () => {
    const now = DEFAULT_TYNN_KANBAN_CONFIG.columns.find((c) => c.id === "now");
    expect(now?.statuses).toEqual(["starting", "doing"]);
  });
});

describe("definePmProvider .kanbanConfig() (s139 t535)", () => {
  it("attaches kanban config to the built definition", () => {
    const def = definePmProvider("my-pm", "My PM")
      .factory(() => ({}))
      .kanbanConfig(DEFAULT_TYNN_KANBAN_CONFIG)
      .build();
    expect(def.kanbanConfig).toBeDefined();
    expect(def.kanbanConfig?.columns).toHaveLength(6);
  });

  it("kanbanConfig is optional — providers can omit it", () => {
    const def = definePmProvider("my-pm", "My PM")
      .factory(() => ({}))
      .build();
    expect(def.kanbanConfig).toBeUndefined();
  });

  it("chainable with description + fields", () => {
    const def = definePmProvider("my-pm", "My PM")
      .description("Test")
      .fields([{ id: "apiKey", label: "API key", type: "password" }])
      .factory(() => ({}))
      .kanbanConfig({ columns: [{ id: "x", name: "X", order: 0 }] })
      .build();
    expect(def.description).toBe("Test");
    expect(def.fields).toHaveLength(1);
    expect(def.kanbanConfig?.columns).toHaveLength(1);
  });
});
