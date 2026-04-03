/**
 * defineTool — chainable builder for AgentToolDefinition.
 */

import type { AgentToolDefinition, AgentToolHandler } from "@aionima/plugins";

class ToolBuilder {
  private def: Partial<AgentToolDefinition>;

  constructor(name: string, description: string) {
    this.def = { name, description };
  }

  inputSchema(schema: Record<string, unknown>): this {
    this.def.inputSchema = schema;
    return this;
  }

  handler(handler: AgentToolHandler): this {
    this.def.handler = handler;
    return this;
  }

  build(): AgentToolDefinition {
    if (!this.def.inputSchema) throw new Error("AgentToolDefinition requires an inputSchema");
    if (!this.def.handler) throw new Error("AgentToolDefinition requires a handler");
    return this.def as AgentToolDefinition;
  }
}

export function defineTool(name: string, description: string): ToolBuilder {
  return new ToolBuilder(name, description);
}
