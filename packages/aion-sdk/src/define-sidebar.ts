/**
 * defineSidebar — chainable builder for SidebarSectionDefinition.
 */

import type { SidebarSectionDefinition, SidebarItem } from "@agi/plugins";

class SidebarBuilder {
  private def: Partial<SidebarSectionDefinition> & { items: SidebarItem[] };

  constructor(id: string, title: string) {
    this.def = { id, title, items: [] };
  }

  item(item: SidebarItem): this {
    this.def.items.push(item);
    return this;
  }

  position(pos: number): this {
    this.def.position = pos;
    return this;
  }

  build(): SidebarSectionDefinition {
    return this.def as SidebarSectionDefinition;
  }
}

export function defineSidebar(id: string, title: string): SidebarBuilder {
  return new SidebarBuilder(id, title);
}
