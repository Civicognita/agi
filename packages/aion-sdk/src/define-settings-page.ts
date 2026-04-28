/**
 * defineSettingsPage — chainable builder for SettingsPageDefinition.
 */

import type { SettingsPageDefinition, SettingsSectionDefinition } from "@agi/plugins";

class SettingsPageBuilder {
  private def: Partial<SettingsPageDefinition> & { sections: SettingsSectionDefinition[] };

  constructor(id: string, label: string) {
    this.def = { id, label, sections: [] };
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

  section(sectionDef: SettingsSectionDefinition): this {
    this.def.sections.push(sectionDef);
    return this;
  }

  build(): SettingsPageDefinition {
    if (this.def.sections.length === 0) throw new Error("SettingsPageDefinition requires at least one section");
    return this.def as SettingsPageDefinition;
  }
}

export function defineSettingsPage(id: string, label: string): SettingsPageBuilder {
  return new SettingsPageBuilder(id, label);
}
