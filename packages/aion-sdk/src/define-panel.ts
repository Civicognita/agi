/**
 * definePanel — chainable builder for ProjectPanelDefinition.
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

  build(): ProjectPanelDefinition {
    if (!this.def.projectTypes) throw new Error("ProjectPanelDefinition requires projectTypes");
    return this.def as ProjectPanelDefinition;
  }
}

export function definePanel(id: string, label: string): PanelBuilder {
  return new PanelBuilder(id, label);
}
