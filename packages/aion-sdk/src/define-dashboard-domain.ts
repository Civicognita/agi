/**
 * defineDashboardDomain — chainable builder for DashboardInterfaceDomainDefinition.
 */

import type { DashboardInterfaceDomainDefinition, DashboardDomainPageDefinition } from "@aionima/plugins";

class DashboardDomainBuilder {
  private def: Partial<DashboardInterfaceDomainDefinition> & { pages: DashboardDomainPageDefinition[] };

  constructor(id: string, title: string) {
    this.def = { id, title, pages: [] };
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

  routePrefix(prefix: string): this {
    this.def.routePrefix = prefix;
    return this;
  }

  page(pageDef: DashboardDomainPageDefinition): this {
    this.def.pages.push(pageDef);
    return this;
  }

  build(): DashboardInterfaceDomainDefinition {
    if (!this.def.routePrefix) throw new Error("DashboardInterfaceDomainDefinition requires a routePrefix");
    if (this.def.pages.length === 0) throw new Error("DashboardInterfaceDomainDefinition requires at least one page");
    return this.def as DashboardInterfaceDomainDefinition;
  }
}

export function defineDashboardDomain(id: string, title: string): DashboardDomainBuilder {
  return new DashboardDomainBuilder(id, title);
}
