/**
 * TaskMaster Orchestrator — LLM-powered work decomposition.
 *
 * Receives a work description and the catalog of available workers,
 * then uses a lightweight LLM call to decompose the work into an
 * ordered sequence of worker phases. Some worker pairs are enforced
 * chains: hacker→tester, writer→editor, modeler→linguist. The
 * enforceChains() post-processor guarantees these are always present
 * even when the LLM omits them.
 */

import type { LLMProvider } from "./llm/provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerSummary {
  domain: string;
  role: string;
  name: string;
  description: string;
  modelTier?: string;
}

export interface WorkPhase {
  domain: string;
  role: string;
  /** Scoped description of what this worker should do in this phase. */
  phaseDescription: string;
  /** "auto" = proceed to next phase; "checkpoint" = pause for user review. */
  gate: "auto" | "checkpoint";
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class TaskmasterOrchestrator {
  constructor(private readonly llmProvider: LLMProvider) {}

  async decompose(
    description: string,
    availableWorkers: WorkerSummary[],
    entityId?: string,
  ): Promise<WorkPhase[]> {
    const workerCatalog = availableWorkers
      .map((w) => `- ${w.domain}.${w.role} (${w.name}): ${w.description}`)
      .join("\n");

    const systemPrompt = ORCHESTRATOR_SYSTEM_PROMPT.replace(
      "{{WORKER_CATALOG}}",
      workerCatalog,
    );

    const response = await this.llmProvider.invoke({
      system: systemPrompt,
      messages: [{ role: "user", content: description }],
      entityId: entityId ?? "taskmaster",
      maxTokens: 1024,
    });

    return parsePhases(response.text, availableWorkers);
  }
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

function parsePhases(
  text: string,
  availableWorkers: WorkerSummary[],
): WorkPhase[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("TaskMaster orchestrator returned no valid JSON phases");
  }

  const validKeys = new Set(
    availableWorkers.map((w) => `${w.domain}.${w.role}`),
  );

  const raw = JSON.parse(jsonMatch[0]) as Array<{
    domain?: string;
    role?: string;
    description?: string;
    phaseDescription?: string;
    gate?: string;
  }>;

  const phases: WorkPhase[] = [];
  for (const entry of raw) {
    const domain = entry.domain ?? "";
    const role = entry.role ?? "";
    const key = `${domain}.${role}`;

    if (!validKeys.has(key)) continue;

    phases.push({
      domain,
      role,
      phaseDescription: entry.phaseDescription ?? entry.description ?? "",
      gate: entry.gate === "checkpoint" ? "checkpoint" : "auto",
    });
  }

  if (phases.length === 0) {
    throw new Error("TaskMaster orchestrator produced no valid phases");
  }

  return enforceChains(phases, availableWorkers);
}

// ---------------------------------------------------------------------------
// Enforced chain rules
// ---------------------------------------------------------------------------

/** Workers whose successor is mandatory regardless of what the LLM emits. */
const ENFORCED_CHAIN_SUCCESSORS: Readonly<Record<string, { domain: string; role: string }>> = {
  "code.hacker":        { domain: "code", role: "tester" },
  "comm.writer.tech":   { domain: "comm", role: "editor" },
  "comm.writer.policy": { domain: "comm", role: "editor" },
  "data.modeler":       { domain: "k",    role: "linguist" },
};

const ENFORCED_CHAIN_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "code.tester":   "Validate and test the implementation from the previous hacker phase.",
  "comm.editor":   "Review and polish the written content from the previous writer phase.",
  "k.linguist":    "Validate naming conventions and terminology from the data modeling phase.",
};

/**
 * Guarantee that every enforced chain source is immediately followed by its
 * required sink. Injects the sink phase when the orchestrator omits it.
 * Already-present consecutive pairs are left untouched.
 *
 * Exported for unit testing.
 */
export function enforceChains(phases: WorkPhase[], availableWorkers: WorkerSummary[]): WorkPhase[] {
  const validKeys = new Set(availableWorkers.map((w) => `${w.domain}.${w.role}`));
  const result: WorkPhase[] = [];

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!;
    result.push(phase);

    const sourceKey = `${phase.domain}.${phase.role}`;
    const required = ENFORCED_CHAIN_SUCCESSORS[sourceKey];
    if (!required) continue;

    const sinkKey = `${required.domain}.${required.role}`;
    if (!validKeys.has(sinkKey)) continue;

    const nextPhase = phases[i + 1];
    const nextKey = nextPhase ? `${nextPhase.domain}.${nextPhase.role}` : null;
    if (nextKey === sinkKey) continue; // LLM already emitted the sink

    result.push({
      domain: required.domain,
      role: required.role,
      phaseDescription:
        ENFORCED_CHAIN_DESCRIPTIONS[sinkKey] ??
        `Validate the output from the ${phase.role} phase.`,
      gate: "auto",
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const ORCHESTRATOR_SYSTEM_PROMPT = `You are TaskMaster, a work orchestrator for the Aionima AI gateway. Your job is to decompose a work request into an ordered sequence of worker phases.

## Available Workers

{{WORKER_CATALOG}}

## Rules

1. Each phase runs exactly one worker. Plan phases in logical order.
2. Order matters: design/planning workers go first, implementation next, validation last.
3. Use only workers from the catalog above. Reference them by domain and role.
4. For simple tasks (single concern, one skill), return a single phase.
5. For complex tasks, return 2-5 phases in logical order.
6. Set gate to "checkpoint" only when the output needs human review before continuing (e.g., after a planner or architect produces a design). Default to "auto".
7. Write a focused phaseDescription for each worker that scopes their work to just their part.
8. ENFORCED CHAINS — these pairs MUST appear consecutively whenever the source is used:
   - code.hacker → code.tester (always follow hacker with tester)
   - comm.writer.tech → comm.editor (always follow writer.tech with editor)
   - comm.writer.policy → comm.editor (always follow writer.policy with editor)
   - data.modeler → k.linguist (always follow modeler with linguist)

## Output Format

Return ONLY a JSON array. No explanation, no markdown. Example:

[
  { "domain": "code", "role": "engineer", "phaseDescription": "Design the authentication middleware architecture", "gate": "auto" },
  { "domain": "code", "role": "hacker", "phaseDescription": "Implement the auth middleware per the engineer's design", "gate": "auto" },
  { "domain": "code", "role": "tester", "phaseDescription": "Write unit and integration tests for the auth middleware", "gate": "auto" }
]`;
