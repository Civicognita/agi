/**
 * definePanel — chainable builder for ProjectPanelDefinition.
 *
 * @deprecated s150 t639 (2026-05-07) — `registerProjectPanel` has zero
 * production callers and conflicts with the trimmed primary/secondary tab
 * model from t638 (plugin panels are part of the secondary overflow, but
 * none have shipped). Plan: delete in the next major SDK rev. Plugins
 * needing per-project surfaces should land their own MApp instead — that
 * surface has clear ownership + UX patterns.
 */

import type { ProjectPanelDefinition, PanelWidget } from "@agi/plugins";

class PanelBuilder {
  private def: Partial<ProjectPanelDefinition> & { widgets: PanelWidget[] };

  constructor(id: string, label: string) {
    this.def = { id, label, widgets: [] };
  }

  projectTypes(types: string[]): this {
    this.def.projectTypes = types;
    return this;
  }

  widget(widget: PanelWidget): this {
    this.def.widgets.push(widget);
    return this;
  }

  position(pos: number): this {
    this.def.position = pos;
    return this;
  }

  mode(mode: "develop" | "operate" | "coordinate" | "insight"): this {
    this.def.mode = mode;
    return this;
  }

  build(): ProjectPanelDefinition {
    if (!this.def.projectTypes) throw new Error("ProjectPanelDefinition requires projectTypes");
    return this.def as ProjectPanelDefinition;
  }
}

export function definePanel(id: string, label: string): PanelBuilder {
  return new PanelBuilder(id, label);
}
