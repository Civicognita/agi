/**
 * Project Config Schema — Zod validation for ~/.agi/{slug}/project.json files.
 *
 * This is the single source of truth for per-project configuration structure.
 * All reads and writes to project.json MUST go through ProjectConfigManager,
 * which validates against these schemas.
 *
 * The root object uses .passthrough() so plugins can store custom keys.
 * The hosting sub-object uses .strict() since it's entirely core-owned.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums — duplicated from gateway-core/project-types.ts to avoid
// circular dependency (config package must not import gateway-core).
// ---------------------------------------------------------------------------

export const ProjectCategorySchema = z.enum([
  "literature",
  "app",
  "web",
  "media",
  "administration",
  "ops",
  "monorepo",
]);

// ---------------------------------------------------------------------------
// Stack instance — persisted per-project in hosting.stacks[]
// ---------------------------------------------------------------------------

export const ProjectStackInstanceSchema = z
  .object({
    /** Stack definition ID (e.g. "stack-node-app", "stack-postgres-17"). */
    stackId: z.string(),
    /** Per-project database name (DB stacks only). */
    databaseName: z.string().optional(),
    /** Per-project database user (DB stacks only). */
    databaseUser: z.string().optional(),
    /** Per-project database password (DB stacks only). */
    databasePassword: z.string().optional(),
    /** ISO 8601 timestamp when the stack was added. */
    addedAt: z.string(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Hosting sub-object — all hosting-related config for a project
// ---------------------------------------------------------------------------

export const ProjectHostingSchema = z
  .object({
    /** Whether hosting is enabled for this project. */
    enabled: z.boolean().default(false),
    /** Project type ID (e.g. "web-app", "api-service", "static-site"). */
    type: z.string().default("static-site"),
    /** Subdomain hostname (e.g. "my-project" → my-project.ai.on). */
    hostname: z.string(),
    /** Document root relative to project dir. */
    docRoot: z.string().nullable().default(null),
    /** Shell command to start the project. */
    startCommand: z.string().nullable().default(null),
    /** Allocated host port for container port mapping. */
    port: z.number().int().nullable().default(null),
    /** Production or development mode. */
    mode: z.enum(["production", "development"]).default("production"),
    /** Override for container internal port. */
    internalPort: z.number().int().nullable().default(null),
    /** Runtime definition ID (from plugin registry). */
    runtimeId: z.string().nullable().optional(),
    /** Active Cloudflare tunnel URL. */
    tunnelUrl: z.string().nullable().optional(),
    /** Named tunnel ID (persists across restarts — same URL forever). */
    tunnelId: z.string().nullable().optional(),
    /** Installed stack instances. */
    stacks: z.array(ProjectStackInstanceSchema).default([]),
    /** MagicApp ID used as the viewer for this project's *.ai.on URL. */
    viewer: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Root project config — the full ~/.agi/{slug}/project.json shape
// ---------------------------------------------------------------------------

export const ProjectConfigSchema = z
  .object({
    /** Display name. */
    name: z.string(),
    /** ISO 8601 creation timestamp. */
    createdAt: z.string().optional(),
    /** Tynn project token (external integration). */
    tynnToken: z.string().optional(),
    /** Project type ID (mirrors hosting.type when hosting is configured). */
    type: z.string().optional(),
    /** Project category (literature, app, web, etc.). */
    category: ProjectCategorySchema.optional(),
    /** Human-readable project description. */
    description: z.string().optional(),
    /** Hosting configuration (present when project has been configured for hosting). */
    hosting: ProjectHostingSchema.optional(),
    /** Attached MagicApp IDs (apps available for this project). */
    magicApps: z.array(z.string()).optional(),
  })
  .passthrough(); // Plugins can store custom keys at the root level

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ProjectHosting = z.infer<typeof ProjectHostingSchema>;
export type ProjectStackInstance = z.infer<typeof ProjectStackInstanceSchema>;
export type ProjectCategory = z.infer<typeof ProjectCategorySchema>;
