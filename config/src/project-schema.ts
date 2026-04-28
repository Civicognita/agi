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
// AI model binding — declared per-project in project.json
// ---------------------------------------------------------------------------

export const ProjectAiModelBindingSchema = z.object({
  /** HuggingFace model ID (e.g. "NeoQuasar/Kronos-base"). */
  modelId: z.string(),
  /** Alias for environment variable naming (e.g. "kronos" → AIONIMA_MODEL_KRONOS_URL). */
  alias: z.string(),
  /** Whether the model must be running for the project to start. */
  required: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// AI dataset binding — declared per-project in project.json
// ---------------------------------------------------------------------------

export const ProjectAiDatasetBindingSchema = z.object({
  /** HuggingFace dataset ID. */
  datasetId: z.string(),
  /** Alias for documentation. */
  alias: z.string(),
  /** Mount path inside the project container (default: /data/{alias}). */
  mountPath: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Iterative-work mode — opt-in per-project. When enabled, the prompt assembler
// injects agi/prompts/iterative-work.md into Aion's system prompt so the agent
// participates in the tynn workflow (race-to-DONE, look-for-MORE, slice
// discipline). The cron field is consumed by the scheduler (t436); leaving it
// undefined while enabled means manual-fire only (e.g. via /next).
// ---------------------------------------------------------------------------

/**
 * Cadence keys offered by the per-project iterative-work tab dropdown.
 * Mirrors the gateway-core IterativeWorkCadence type (kept in sync; config
 * package can't import gateway-core to avoid a circular dep). The user picks
 * the cadence; the system auto-staggers the actual cron expression at save
 * time via cadenceToStaggeredCron in iterative-work/cron.ts.
 *
 * Available options narrow by project category at the UI layer:
 * - dev (web/app): 30m, 1h
 * - ops (ops/administration): 30m, 1h, 5h, 12h, 1d, 5d, 1w
 */
export const IterativeWorkCadenceSchema = z.enum([
  "30m",
  "1h",
  "5h",
  "12h",
  "1d",
  "5d",
  "1w",
]);

export const ProjectIterativeWorkSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** User-picked cadence (s118 redesign 2026-04-27). Stored alongside cron. */
    cadence: IterativeWorkCadenceSchema.optional(),
    /**
     * Cron expression. When `cadence` is set, this is auto-computed from
     * cadenceToStaggeredCron(cadence, projectPath) at save time. When only
     * `cron` is set (legacy), it remains the source of truth — user-edited
     * pre-redesign configs continue working.
     */
    cron: z.string().optional(),
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
    /** AI model dependencies this project uses. Models must be installed via HF Marketplace. */
    aiModels: z.array(ProjectAiModelBindingSchema).optional(),
    /** AI dataset dependencies. Datasets are mounted as read-only volumes. */
    aiDatasets: z.array(ProjectAiDatasetBindingSchema).optional(),
    /** Iterative-work mode — toggles tynn-workflow prompt injection + cron-nudged scheduling. */
    iterativeWork: ProjectIterativeWorkSchema.optional(),
  })
  .passthrough(); // Plugins can store custom keys at the root level

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type ProjectHosting = z.infer<typeof ProjectHostingSchema>;
export type ProjectStackInstance = z.infer<typeof ProjectStackInstanceSchema>;
export type ProjectCategory = z.infer<typeof ProjectCategorySchema>;
export type ProjectAiModelBinding = z.infer<typeof ProjectAiModelBindingSchema>;
export type ProjectAiDatasetBinding = z.infer<typeof ProjectAiDatasetBindingSchema>;
export type ProjectIterativeWork = z.infer<typeof ProjectIterativeWorkSchema>;
export type IterativeWorkCadence = z.infer<typeof IterativeWorkCadenceSchema>;
