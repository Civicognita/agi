/**
 * Plan -> Tynn Mapper
 *
 * Maps approved plans to Tynn entity operations based on size heuristic:
 * - 1 step -> single task under current story
 * - 2-5 steps, single concern -> story + batch tasks
 * - 6+ steps or multiple concerns -> version + stories + tasks
 *
 * The mapper generates a structured natural-language prompt that tells
 * the agent exactly what Tynn items to create via MCP tools.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TynnMappingStrategy = "task-only" | "story-tasks" | "version-stories-tasks";

export interface TynnMappingResult {
  strategy: TynnMappingStrategy;
  /** The structured prompt for the agent to execute via Tynn MCP tools. */
  prompt: string;
}

export interface PlanForMapping {
  id: string;
  title: string;
  steps: Array<{ id: string; title: string; type: string }>;
  body: string;
  projectPath: string;
}

// ---------------------------------------------------------------------------
// Strategy determination
// ---------------------------------------------------------------------------

export function determineMappingStrategy(plan: PlanForMapping): TynnMappingStrategy {
  const stepCount = plan.steps.length;
  if (stepCount <= 1) return "task-only";
  if (stepCount <= 5) return "story-tasks";
  return "version-stories-tasks";
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildTaskOnlyPrompt(plan: PlanForMapping): string {
  const step = plan.steps[0];
  const stepTitle = step?.title ?? plan.title;

  return [
    `Plan '${plan.title}' has been approved for project at ${plan.projectPath}.`,
    `Create a single Tynn task titled '${stepTitle}' using the Tynn MCP tools (use \`create\` tool with \`a: 'task'\`).`,
    `After creating, report the task ID.`,
    ``,
    `After creating all items, return a JSON object with the format: \`{"versionId": null, "storyIds": [], "taskIds": ["<created-task-id>"]}\``,
  ].join(" ");
}

function buildStoryTasksPrompt(plan: PlanForMapping): string {
  const stepList = plan.steps
    .map((s, i) => `  ${String(i + 1)}. "${s.title}" (type: ${s.type})`)
    .join("\n");

  return [
    `Plan '${plan.title}' has been approved for project at ${plan.projectPath}.`,
    `Create a Tynn story titled '${plan.title}' and then create ${String(plan.steps.length)} tasks under it:\n${stepList}`,
    `Use the Tynn MCP \`create\` tool with batch support (create story first, then create tasks with \`with: {tasks: [...]}\` or individual creates).`,
    `Report all created IDs.`,
    ``,
    `After creating all items, return a JSON object with the format: \`{"versionId": null, "storyIds": ["<story-id>"], "taskIds": ["<task-1-id>", "<task-2-id>", ...]}\``,
  ].join(" ");
}

function buildVersionStoriesTasksPrompt(plan: PlanForMapping): string {
  // Group steps by type for story grouping
  const byType = new Map<string, Array<{ id: string; title: string; type: string }>>();
  for (const step of plan.steps) {
    const group = byType.get(step.type) ?? [];
    group.push(step);
    byType.set(step.type, group);
  }

  const groupDescriptions = Array.from(byType.entries())
    .map(([type, steps]) => {
      const items = steps.map((s) => `"${s.title}"`).join(", ");
      return `  - Story for "${type}" steps: ${items}`;
    })
    .join("\n");

  return [
    `Plan '${plan.title}' has been approved for project at ${plan.projectPath}.`,
    `Create a Tynn version titled '${plan.title}', then create stories grouped by step type, with tasks under each story:\n${groupDescriptions}`,
    `Use the Tynn MCP \`create\` tool.`,
    `Report all created IDs (version, stories, tasks).`,
    ``,
    `After creating all items, return a JSON object with the format: \`{"versionId": "<version-id>", "storyIds": ["<story-1-id>", ...], "taskIds": ["<task-1-id>", ...]}\``,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildTynnSyncPrompt(plan: PlanForMapping): TynnMappingResult {
  const strategy = determineMappingStrategy(plan);

  let prompt: string;

  switch (strategy) {
    case "task-only":
      prompt = buildTaskOnlyPrompt(plan);
      break;
    case "story-tasks":
      prompt = buildStoryTasksPrompt(plan);
      break;
    case "version-stories-tasks":
      prompt = buildVersionStoriesTasksPrompt(plan);
      break;
  }

  return { strategy, prompt };
}
