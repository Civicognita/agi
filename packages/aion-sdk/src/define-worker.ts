/**
 * defineWorker — chainable builder for WorkerDefinition.
 *
 * ## Example
 *
 * ```ts
 * import { defineWorker } from "@aionima/sdk";
 *
 * const hacker = defineWorker("code.hacker", "Code Hacker")
 *   .domain("code")
 *   .role("hacker")
 *   .description("Implementation worker for code tasks")
 *   .prompt(hackerPrompt)
 *   .modelTier("capable")
 *   .allowedTools(["Read", "Write", "Edit", "Bash", "Glob", "Grep"])
 *   .chainTarget("code.tester")
 *   .requiredTier("verified")
 *   .keywords(["implement", "build", "code", "fix"])
 *   .build();
 *
 * api.registerWorker(hacker);
 * ```
 */

import type { WorkerDefinition, WorkerDomain } from "@aionima/plugins";

class WorkerBuilder {
  private def: Partial<WorkerDefinition> & { id: string; name: string };

  constructor(id: string, name: string) {
    this.def = { id, name };
  }

  domain(d: WorkerDomain): this { this.def.domain = d; return this; }
  role(r: string): this { this.def.role = r; return this; }
  description(desc: string): this { this.def.description = desc; return this; }
  prompt(p: string): this { this.def.prompt = p; return this; }
  modelTier(tier: "fast" | "balanced" | "capable"): this { this.def.modelTier = tier; return this; }
  allowedTools(tools: string[]): this { this.def.allowedTools = tools; return this; }
  chainTarget(target: string): this { this.def.chainTarget = target; return this; }
  requiredTier(tier: "verified" | "sealed"): this { this.def.requiredTier = tier; return this; }
  keywords(kw: string[]): this { this.def.keywords = kw; return this; }

  build(): WorkerDefinition {
    if (!this.def.domain) throw new Error("defineWorker: domain is required");
    if (!this.def.role) throw new Error("defineWorker: role is required");
    if (!this.def.description) throw new Error("defineWorker: description is required");
    if (!this.def.prompt) throw new Error("defineWorker: prompt is required");
    return this.def as WorkerDefinition;
  }
}

export function defineWorker(id: string, name: string): WorkerBuilder {
  return new WorkerBuilder(id, name);
}
