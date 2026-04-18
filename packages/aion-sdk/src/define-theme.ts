/**
 * defineTheme — chainable builder for ThemeDefinition.
 */

import type { ThemeDefinition } from "@agi/plugins";

class ThemeBuilder {
  private def: Partial<ThemeDefinition> & { properties: Record<string, string> };

  constructor(id: string, name: string) {
    this.def = { id, name, properties: {} };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  dark(isDark = true): this {
    this.def.dark = isDark;
    return this;
  }

  property(key: string, value: string): this {
    this.def.properties[key] = value;
    return this;
  }

  properties(props: Record<string, string>): this {
    Object.assign(this.def.properties, props);
    return this;
  }

  build(): ThemeDefinition {
    if (this.def.dark === undefined) this.def.dark = false;
    return this.def as ThemeDefinition;
  }
}

export function defineTheme(id: string, name: string): ThemeBuilder {
  return new ThemeBuilder(id, name);
}
