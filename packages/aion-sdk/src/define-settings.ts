/**
 * defineSettings — chainable builder for SettingsSectionDefinition.
 */

import type { SettingsSectionDefinition, UIField } from "@aionima/plugins";

class SettingsBuilder {
  private def: Partial<SettingsSectionDefinition> & { fields: UIField[] };

  constructor(id: string, label: string) {
    this.def = { id, label, fields: [] };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  configPath(path: string): this {
    this.def.configPath = path;
    return this;
  }

  field(field: UIField): this {
    this.def.fields.push(field);
    return this;
  }

  position(pos: number): this {
    this.def.position = pos;
    return this;
  }

  build(): SettingsSectionDefinition {
    if (!this.def.configPath) throw new Error("SettingsSectionDefinition requires a configPath");
    return this.def as SettingsSectionDefinition;
  }
}

export function defineSettings(id: string, label: string): SettingsBuilder {
  return new SettingsBuilder(id, label);
}
