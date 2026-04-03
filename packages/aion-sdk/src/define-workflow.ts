/**
 * defineWorkflow — chainable builder for WorkflowDefinition.
 */

import type { WorkflowDefinition, WorkflowStep } from "@aionima/plugins";

class WorkflowBuilder {
  private def: Partial<WorkflowDefinition> & { steps: WorkflowStep[] };

  constructor(id: string, name: string) {
    this.def = { id, name, steps: [] };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  trigger(trigger: "manual" | "event" | "scheduled"): this {
    this.def.trigger = trigger;
    return this;
  }

  triggerEvent(event: string): this {
    this.def.triggerEvent = event;
    return this;
  }

  step(step: WorkflowStep): this {
    this.def.steps.push(step);
    return this;
  }

  build(): WorkflowDefinition {
    if (!this.def.trigger) this.def.trigger = "manual";
    return this.def as WorkflowDefinition;
  }
}

export function defineWorkflow(id: string, name: string): WorkflowBuilder {
  return new WorkflowBuilder(id, name);
}
