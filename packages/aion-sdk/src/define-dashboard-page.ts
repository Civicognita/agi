/**
 * defineDashboardPage — chainable builder for DashboardInterfacePageDefinition.
 */

import type { DashboardInterfacePageDefinition, PanelWidget } from "@agi/plugins";

class DashboardPageBuilder {
  private def: Partial<DashboardInterfacePageDefinition> & { widgets: PanelWidget[] };

  constructor(id: string, label: string) {
    this.def = { id, label, widgets: [] };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  icon(icon: string): this {
    this.def.icon = icon;
    return this;
  }

  position(pos: number): this {
    this.def.position = pos;
    return this;
  }

  domain(domainId: string): this {
    this.def.domain = domainId;
    return this;
  }

  routePath(path: string): this {
    this.def.routePath = path;
    return this;
  }

  widget(widget: PanelWidget): this {
    this.def.widgets.push(widget);
    return this;
  }

  build(): DashboardInterfacePageDefinition {
    if (!this.def.domain) throw new Error("DashboardInterfacePageDefinition requires a domain");
    if (!this.def.routePath) throw new Error("DashboardInterfacePageDefinition requires a routePath");
    return this.def as DashboardInterfacePageDefinition;
  }
}

export function defineDashboardPage(id: string, label: string): DashboardPageBuilder {
  return new DashboardPageBuilder(id, label);
}
