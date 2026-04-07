/**
 * MagicApp Schema — Zod validation for the JSON-serializable parts
 * of MagicApp definitions.
 *
 * Container config functions (volumeMounts, env, command) are NOT
 * validated here — they're runtime functions provided by the plugin.
 * This schema validates the declarative JSON structure.
 */

import { z } from "zod";
import { ProjectCategorySchema } from "./project-schema.js";

export const MagicAppCategorySchema = z.enum([
  "viewer", "production", "tool", "game", "custom",
]);

export const MagicAppAgentPromptSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  systemPrompt: z.string(),
  allowedTools: z.array(z.string()).optional(),
}).strict();

export const MagicAppWorkflowStepSchema = z.object({
  id: z.string(),
  type: z.enum(["shell", "api", "agent", "file-transform"]),
  label: z.string(),
  config: z.record(z.unknown()),
  dependsOn: z.array(z.string()).optional(),
}).strict();

export const MagicAppWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  trigger: z.enum(["manual", "on-file-change", "scheduled"]),
  steps: z.array(MagicAppWorkflowStepSchema),
}).strict();

export const MagicAppThemeSchema = z.object({
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  fontFamily: z.string().optional(),
  cssProperties: z.record(z.string()).optional(),
}).strict();

export const MagicAppPanelSchema = z.object({
  label: z.string(),
  widgets: z.array(z.record(z.unknown())), // PanelWidget validated at runtime
  position: z.number().optional(),
}).strict();

export const MagicAppToolSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  action: z.enum(["shell", "api", "ui"]),
  command: z.string().optional(),
  endpoint: z.string().optional(),
}).strict();

export const MagicAppChainSchema = z.object({
  contentHash: z.string().optional(),
  address: z.string().optional(),
}).strict();

/** Validates the JSON-serializable portion of a MagicApp definition. */
export const MagicAppJsonSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  icon: z.string().optional(),
  category: MagicAppCategorySchema,
  projectTypes: z.array(z.string()).min(1),
  projectCategories: z.array(ProjectCategorySchema),
  panel: MagicAppPanelSchema,
  agentPrompts: z.array(MagicAppAgentPromptSchema).optional(),
  workflows: z.array(MagicAppWorkflowSchema).optional(),
  tools: z.array(MagicAppToolSchema).optional(),
  theme: MagicAppThemeSchema.optional(),
  chain: MagicAppChainSchema.optional(),
}).strict();

export type MagicAppJson = z.infer<typeof MagicAppJsonSchema>;
