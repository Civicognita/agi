/**
 * defineAction — chainable builder for ActionDefinition.
 */

import type { ActionDefinition, ActionScope, ActionHandler } from "@agi/plugins";

class ActionBuilder {
  private def: Partial<ActionDefinition>;

  constructor(id: string, label: string) {
    this.def = { id, label };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  icon(icon: string): this {
    this.def.icon = icon;
    return this;
  }

  scope(scope: ActionScope): this {
    this.def.scope = scope;
    return this;
  }

  handler(handler: ActionHandler): this {
    this.def.handler = handler;
    return this;
  }

  confirm(message: string): this {
    this.def.confirm = message;
    return this;
  }

  group(group: string): this {
    this.def.group = group;
    return this;
  }

  destructive(val = true): this {
    this.def.destructive = val;
    return this;
  }

  build(): ActionDefinition {
    if (!this.def.scope) throw new Error("ActionDefinition requires a scope");
    if (!this.def.handler) throw new Error("ActionDefinition requires a handler");
    return this.def as ActionDefinition;
  }
}

export function defineAction(id: string, label: string): ActionBuilder {
  return new ActionBuilder(id, label);
}
