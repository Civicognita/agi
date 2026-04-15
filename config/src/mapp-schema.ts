/**
 * MApp JSON Schema — Zod validation for ~/.agi/mapps/{author}/{slug}.json
 *
 * Validates the complete MApp definition file. Used during:
 * - File-based discovery at boot
 * - Security scanning before install
 * - BuilderChat create_magic_app tool
 */

import { z } from "zod";

export const MAppPermissionSchema = z.object({
  id: z.string(),
  reason: z.string(),
  required: z.boolean(),
}).strict();

export const MAppContainerConfigSchema = z.object({
  image: z.string(),
  internalPort: z.number().int().positive(),
  volumeMounts: z.array(z.string()),
  env: z.record(z.string()).optional(),
  command: z.array(z.string()).optional(),
  healthCheck: z.string().optional(),
}).strict();

export const MAppPanelSchema = z.object({
  label: z.string(),
  widgets: z.array(z.record(z.unknown())),
  position: z.number().optional(),
}).strict();

export const MAppThemeSchema = z.object({
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  fontFamily: z.string().optional(),
  cssProperties: z.record(z.string()).optional(),
}).strict();

export const MAppAgentPromptSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  systemPrompt: z.string(),
  allowedTools: z.array(z.string()).optional(),
}).strict();

export const MAppModelInferenceConfigSchema = z.object({
  /** HuggingFace model ID to call (must be installed and running). */
  modelId: z.string(),
  /** Path on the model container (e.g. "/predict", "/v1/chat/completions"). */
  endpoint: z.string(),
  /** HTTP method (default "POST"). */
  method: z.enum(["GET", "POST"]).default("POST"),
  /**
   * JSON body template. Values may contain {{variableName}} placeholders
   * which are resolved against the current workflow context before sending.
   */
  inputTemplate: z.record(z.unknown()).optional(),
  /** Key in the workflow context where the response is stored. */
  outputKey: z.string(),
}).strict();

export const MAppWorkflowStepSchema = z.object({
  id: z.string(),
  type: z.enum(["shell", "api", "agent", "file-transform", "model-inference"]),
  label: z.string(),
  config: z.record(z.unknown()),
  dependsOn: z.array(z.string()).optional(),
}).strict();

export const MAppWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  trigger: z.enum(["manual", "on-file-change", "scheduled"]),
  steps: z.array(MAppWorkflowStepSchema),
}).strict();

export const MAppToolSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  action: z.enum(["shell", "api", "ui"]),
  command: z.string().optional(),
  endpoint: z.string().optional(),
}).strict();

// ---------------------------------------------------------------------------
// Form system schemas
// ---------------------------------------------------------------------------

const MAppFieldTypeSchema = z.enum([
  "text", "textarea", "number", "int", "currency",
  "percentage", "number_range", "date", "date_range",
  "time", "duration", "email", "phone", "url",
  "bool", "select", "multiselect", "file", "info",
]);

const MAppConditionSchema = z.object({
  showIf: z.object({
    source: z.enum(["inputs", "process_page", "context"]),
    field: z.string(),
    operator: z.enum(["equals", "not_equals", "greater_than", "less_than", "contains", "in", "not_in", "not_empty", "is_empty"]),
    value: z.unknown().optional(),
    page: z.string().optional(),
  }).strict(),
}).strict();

export const MAppFieldSchema = z.object({
  key: z.string(),
  cell: z.string(),
  type: MAppFieldTypeSchema,
  label: z.string(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  conditions: MAppConditionSchema.optional(),
}).strict();

export const MAppFormulaSchema = z.object({
  cell: z.string(),
  label: z.string(),
  expression: z.string(),
  format: z.enum(["number", "currency", "percent", "text"]),
  visible: z.boolean(),
}).strict();

export const MAppConstantSchema = z.object({
  key: z.string(),
  cell: z.string(),
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  format: z.enum(["number", "currency", "percent"]),
  visibility: z.enum(["always", "hidden", "conditional"]),
}).strict();

export const MAppPageSchema = z.object({
  key: z.string(),
  title: z.string(),
  pageType: z.enum(["standard", "magic", "embedded", "canvas"]),
  visibility: z.enum(["always", "conditional", "auto", "hidden"]),
  fields: z.array(MAppFieldSchema).optional(),
  formulas: z.array(MAppFormulaSchema).optional(),
  conditions: MAppConditionSchema.optional(),
  processPage: z.string().optional(),
  url: z.string().optional(),
  widgets: z.array(z.record(z.unknown())).optional(),
}).strict();

export const MAppOutputSchema = z.object({
  producesFile: z.boolean().optional(),
  fileType: z.enum(["text", "doc", "csv", "spreadsheet"]).optional(),
  processingPrompt: z.string().optional(),
}).strict();

// ---------------------------------------------------------------------------
// Full definition schema
// ---------------------------------------------------------------------------

/** Full MApp definition Zod schema. */
export const MAppDefinitionSchema = z.object({
  $schema: z.literal("mapp/1.0"),
  id: z.string().min(1),
  name: z.string().min(1),
  author: z.string().min(1),
  version: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  license: z.string().optional(),
  category: z.enum(["viewer", "production", "tool", "game", "custom"]),
  projectTypes: z.array(z.string()).optional(),
  projectCategories: z.array(z.string()).optional(),
  permissions: z.array(MAppPermissionSchema),
  container: MAppContainerConfigSchema.optional(),
  panel: MAppPanelSchema,
  theme: MAppThemeSchema.optional(),
  dockable: z.boolean().optional(),
  pages: z.array(MAppPageSchema).optional(),
  constants: z.array(MAppConstantSchema).optional(),
  output: MAppOutputSchema.optional(),
  prompts: z.array(MAppAgentPromptSchema).optional(),
  workflows: z.array(MAppWorkflowSchema).optional(),
  tools: z.array(MAppToolSchema).optional(),
  /** AI model dependencies this MApp requires. */
  modelDependencies: z.array(z.object({
    /** HuggingFace model ID (e.g. "NeoQuasar/Kronos-base"). */
    modelId: z.string(),
    /** Human-readable label for display. */
    label: z.string(),
    /** Whether the MApp can function without this model running. */
    required: z.boolean().default(false),
    /** Expected pipeline tag for validation (e.g. "text-generation"). */
    pipelineTag: z.string().optional(),
  })).optional(),
  chain: z.object({
    contentHash: z.string().optional(),
    address: z.string().optional(),
  }).strict().optional(),
}).strict();

export type MAppDefinitionJson = z.infer<typeof MAppDefinitionSchema>;
