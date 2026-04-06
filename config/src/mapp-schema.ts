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

export const MAppWorkflowStepSchema = z.object({
  id: z.string(),
  type: z.enum(["shell", "api", "agent", "file-transform"]),
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
  category: z.enum(["reader", "gallery", "tool", "suite", "editor", "viewer", "game", "custom"]),
  projectTypes: z.array(z.string()).optional(),
  projectCategories: z.array(z.string()).optional(),
  permissions: z.array(MAppPermissionSchema),
  container: MAppContainerConfigSchema.optional(),
  panel: MAppPanelSchema,
  theme: MAppThemeSchema.optional(),
  prompts: z.array(MAppAgentPromptSchema).optional(),
  workflows: z.array(MAppWorkflowSchema).optional(),
  tools: z.array(MAppToolSchema).optional(),
  chain: z.object({
    contentHash: z.string().optional(),
    address: z.string().optional(),
  }).strict().optional(),
}).strict();

export type MAppDefinitionJson = z.infer<typeof MAppDefinitionSchema>;
