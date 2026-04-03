/**
 * defineSkill — chainable builder for SkillRegistration.
 */

import type { SkillRegistration } from "@aionima/plugins";

class SkillBuilder {
  private def: Partial<SkillRegistration> & { triggers: string[] };

  constructor(name: string) {
    this.def = { name, triggers: [] };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  domain(domain: string): this {
    this.def.domain = domain;
    return this;
  }

  trigger(trigger: string): this {
    this.def.triggers.push(trigger);
    return this;
  }

  content(content: string): this {
    this.def.content = content;
    return this;
  }

  build(): SkillRegistration {
    if (!this.def.domain) throw new Error("SkillRegistration requires a domain");
    if (!this.def.content) throw new Error("SkillRegistration requires content");
    return this.def as SkillRegistration;
  }
}

export function defineSkill(name: string): SkillBuilder {
  return new SkillBuilder(name);
}
