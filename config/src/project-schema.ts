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
    /**
     * List of MApp IDs installed in this project's container. Only
     * meaningful when the project's `type` is registered as Desktop-served
     * (see Type Registry's `servesDesktop` flag — s150). Each id resolves to
     * a MApp definition from the MApp Marketplace. Surfaced as launcher
     * tiles on the Aion Desktop at the project root URL; each MApp is also
     * addressable at <project>.ai.on/<mappId>/.
     */
    mapps: z.array(z.string()).optional(),
    // s150 (2026-05-07): `containerKind` was removed. Type registry now
    // derives the code-served-vs-Desktop-served binary from `type`. Legacy
    // values in existing project.json files are tolerated by .passthrough()
    // and stripped by the s150 migration script (s150 t632).
  })
  .passthrough();

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
// Per-project MCP servers (s118 t446 / Wish #7) — surfaces on the project's
// MCP tab. Each server reaches an external Model Context Protocol service
// (tynn, github, custom plugins). Auth tokens reference values in the
// project's .env file via $VAR notation; never store secrets in project.json.
// ---------------------------------------------------------------------------

export const ProjectMcpServerSchema = z
  .object({
    /** Stable id used to reference this server from agent tools / config.
     *  Per-project ids are namespaced at boot as `<slug>:<id>` to avoid
     *  collision across projects. */
    id: z.string(),
    /** Display name shown in UX. Defaults to id. */
    name: z.string().optional(),
    /** Transport selector. */
    transport: z.enum(["stdio", "http", "websocket"]),
    /** Stdio: command to spawn. */
    command: z.array(z.string()).optional(),
    /** Stdio: env vars to inject. Values may be `$VAR` to resolve from
     *  the project's .env at registration time. */
    env: z.record(z.string()).optional(),
    /** http/websocket: server URL. May include `$VAR` for env-resolved bits. */
    url: z.string().optional(),
    /** Whether to register on gateway boot (auto) or lazily on first call. */
    autoConnect: z.boolean().default(true),
    /** Auth token, env-var-resolvable (e.g. `$TYNN_API_KEY`). */
    authToken: z.string().optional(),
  })
  .strict();

export const ProjectMcpSchema = z
  .object({
    servers: z.array(ProjectMcpServerSchema).default([]),
  })
  .strict();

/**
 * Per-repo entry inside `<projectPath>/repos/<name>/` — s130 phase B (t515).
 *
 * Each entry describes a sub-repo bind-mounted into the project's
 * `repos/` folder. The gateway clones from `url` to
 * `<projectPath>/repos/<name>/` lazily (or eagerly during a future
 * provisioning step). Multiple repos under one project let a hosted
 * service compose several codebases (e.g. `web` + `api` + `sdk` for
 * an app project).
 *
 * Per Q-5 owner answer (cycle 88): bind-mounted git checkouts are
 * the chosen shape — read-only by default; write-on-explicit-action.
 */
export const ProjectRepoSchema = z
  .object({
    /** Stable per-project name. Used as the directory name under
     *  `<projectPath>/repos/<name>/`. Must be filesystem-safe. */
    name: z.string().regex(/^[a-zA-Z0-9_-]+$/, "name must be filesystem-safe (a-z, A-Z, 0-9, _, -)"),
    /** Git clone URL. Supports https://, ssh://, or shorthand owner/repo. */
    url: z.string(),
    /** Branch to check out at clone time. Defaults to the upstream's
     *  default branch when omitted. */
    branch: z.string().optional(),
    /** Override the checkout path. Defaults to `<projectPath>/repos/<name>/`
     *  when omitted; rare to override. */
    path: z.string().optional(),
    /** Whether the gateway has write permission to push back here.
     *  Defaults to false — clones are read-only by default per
     *  s130 Q-5 (write-on-explicit-action). */
    writable: z.boolean().default(false),

    // ---- Runtime fields (s130 t515 cycle 123 — multi-repo single-container hosting) ----
    //
    // Owner spec 2026-04-29: "This UX should allow users to have multiple
    // programs/repos running in its container... most often used for
    // monorepo projects that have a client and server and need to serve
    // multiple vite servers that are accessible through a single secured
    // proxy via the network url."
    //
    // All repos with `port` set live as processes inside the SAME project
    // container (single shared container per project). They reach each
    // other via container localhost. The host enforces no port binding —
    // Caddy routes external traffic via the podman aionima network.

    /** Internal port this repo's process listens on inside the container.
     *  Required when the repo runs a server (vite, fastify, express, etc.).
     *  Sibling repos in the same container reach this port via localhost.
     *  When unset, the repo is treated as a code-only checkout (library,
     *  static asset bundle) — not started as a process. */
    port: z.number().int().min(1).max(65535).optional(),

    /** Command that starts this repo's process. Run inside the container
     *  with cwd = the repo's checkout path. Examples:
     *    "pnpm dev"
     *    "node dist/server.js"
     *    "uvicorn app:main --host 0.0.0.0 --port 8001"
     *  Required when `port` is set. */
    startCommand: z.string().optional(),

    /** Optional development-mode command, distinct from startCommand. When
     *  the dashboard's "Dev" affordance launches the repo, this command
     *  runs instead — typical examples:
     *    startCommand: "node dist/server.js" (production-shape)
     *    devCommand:   "pnpm dev"           (vite, hot reload, source maps)
     *  When unset, "Dev" falls back to startCommand. (s141 t551) */
    devCommand: z.string().optional(),

    /** Per-repo custom actions surfaced as buttons in the dashboard's
     *  hosting card (e.g. "Run tests", "Lint", "Migrate DB"). Each action
     *  is one shell command run inside the container with cwd = the
     *  repo's checkout path. Action labels must be unique per repo.
     *  (s141 t551) */
    actions: z.array(z.object({
      /** Display label for the dashboard button. Short — fits in a
       *  per-repo card row. Example: "Run tests", "Lint", "Build". */
      label: z.string().min(1).max(40),
      /** Shell command to execute. Examples:
       *    "pnpm test"
       *    "pnpm lint --fix"
       *    "drizzle-kit push" */
      command: z.string().min(1),
      /** Optional one-line description shown as a tooltip / hover hint.
       *  Useful when the label can't fully describe what the action
       *  does (e.g. "Migrate DB" → "Runs drizzle-kit push against the
       *  project's hosted Postgres"). */
      description: z.string().optional(),
    }).strict()).optional(),

    /** Marks this repo as the default served on `https://<project>.ai.on/`.
     *  At most one repo per project may set this true (enforced via
     *  ProjectConfigSchema.refine). When no repo is marked default, the
     *  project root acts as the default (single-repo behavior). */
    isDefault: z.boolean().optional(),

    /** Caddy path prefix that routes to this repo's port externally
     *  (e.g., "/api" → `https://<project>.ai.on/api/*` proxies to this
     *  repo's `port`). When unset AND `port` is set, the repo is
     *  internal-only — accessible to sibling repos via container
     *  localhost but NOT exposed via Caddy. Default repo (isDefault=true)
     *  ignores this field — it serves at "/" by definition. */
    externalPath: z.string().regex(/^\/[a-zA-Z0-9_/-]*$/, "externalPath must start with / and contain only safe URL chars").optional(),

    /** Optional environment variables passed to this repo's process.
     *  Merged with project-level env. */
    env: z.record(z.string(), z.string()).optional(),

    /** Whether this repo's process auto-starts when the project container
     *  boots. Defaults to true when `port` and `startCommand` are set;
     *  set explicitly false to skip the repo from the boot-time
     *  concurrently invocation. Owner can still start it on-demand via
     *  `podman exec` (or the dashboard's per-repo Start button).
     *  Ignored for code-only repos (no port). */
    autoRun: z.boolean().optional(),

    /** Stacks attached to this specific repo (s141 — per-repo stack
     *  attachment per owner directive cycle 150: "Stacks now attach to
     *  project repos, not to projects themselves"). Multi-stack-per-repo
     *  is supported (e.g. nextjs + tailwind + fancy-ui all on one repo).
     *  When migrating from the legacy project-level attachedStacks, the
     *  s140 --execute step lands stacks on the first repo by default. */
    attachedStacks: z.array(ProjectStackInstanceSchema).optional(),
  })
  .strict()
  .refine(
    (r) => !r.port || r.startCommand,
    { message: "startCommand is required when port is set" },
  )
  .refine(
    (r) => !r.externalPath || r.port,
    { message: "externalPath only applies to repos with a port set" },
  )
  .refine(
    (r) => !r.isDefault || r.port,
    { message: "isDefault only applies to repos with a port set" },
  )
  .refine(
    (r) => r.autoRun === undefined || r.port !== undefined,
    { message: "autoRun only applies to repos with a port set" },
  )
  .refine(
    (r) => {
      if (!r.actions || r.actions.length === 0) return true;
      const labels = r.actions.map((a) => a.label);
      return new Set(labels).size === labels.length;
    },
    { message: "action labels must be unique within a repo" },
  );

// ---------------------------------------------------------------------------
// Channel-room bindings — CHN-D (s165) slice 1, 2026-05-14
//
// Owner-bound rooms surface in the project workspace's Channels tab and
// drive event routing (CHN-C dispatcher finds the bound project via the
// findProjectByRoom index). Channel-specific encoding lives in
// `roomId` (free-form string); the plugin parses it on read.
//
// Reference: agi/docs/agents/channel-plugin-redesign.md §5.
// ---------------------------------------------------------------------------

export const ProjectRoomBindingSchema = z
  .object({
    /** Channel id ("discord", "telegram", "email", "slack", "whatsapp", "signal"). */
    channelId: z.string().min(1),
    /** Channel-scoped room id (e.g. "1234567890:forum:42" for Discord, "C0123" for Slack). */
    roomId: z.string().min(1),
    /**
     * Human-readable label cached at bind time (e.g. "#general", "Bug Reports forum").
     * Lets the dashboard render the binding without re-fetching from the channel.
     */
    label: z.string().optional(),
    /**
     * Kind hint cached at bind time. Free-form string because each channel uses
     * its own room-type vocabulary (Discord: channel/forum/thread/dm; Slack: channel/dm/group-dm/huddle; Telegram: chat/group/channel; Email: thread/label/mailbox).
     */
    kind: z.string().optional(),
    /** Visibility scope cached at bind time. */
    privacy: z.enum(["public", "private", "secret"]).optional(),
    /** ISO 8601 timestamp when the binding was created. */
    boundAt: z.string(),
    /** Optional free-form binding-time metadata (parent room id, channel-specific extras). */
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Root project config — the full <projectPath>/.agi/project.json shape
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
    // s150 (2026-05-07): `category` was removed. `type` is now the single
    // source of truth for project classification. Legacy values tolerated
    // by the root-level .passthrough() and stripped by the s150 migration
    // script (s150 t632). ProjectCategorySchema export is preserved for
    // back-compat consumers (magic-app-schema.ts) until they migrate.
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
    /**
     * @deprecated s131 (2026-05-09) — per-project MCP servers moved to a
     * top-level `<projectPath>/.mcp.json` file (Claude Code convention).
     * The boot-time migration in `mcp-config-migration.ts` rewrites this
     * field into `.mcp.json` and strips it from project.json on first
     * boot after the upgrade. New writes (PUT /api/projects/mcp/server)
     * land in `.mcp.json` directly. Reads fall through via the dual-read
     * API in `mcp-config-store.ts`. Kept here as `.optional()` so legacy
     * project.json files parse without error during the migration window.
     */
    mcp: ProjectMcpSchema.optional(),
    /** Sub-repos served from this project — s130 phase B (t515).
     *  Each entry clones into `<projectPath>/repos/<name>/`. Used by
     *  multi-repo projects (e.g. app projects hosting web + api + sdk
     *  in one container). When empty/undefined, the project is
     *  single-repo and its source lives at the root.
     *
     *  Each repo with `port` set becomes a process inside the shared
     *  project container, reaching siblings via localhost. At most one
     *  repo may set `isDefault: true` (the one served on `/`). */
    repos: z.array(ProjectRepoSchema).optional(),
    /** Channel rooms bound to this project — CHN-D (s165) slice 1.
     *  Each entry binds one room from one channel (Discord, Telegram,
     *  Slack, Email, WhatsApp, Signal) to this project. The CHN-C
     *  gateway dispatcher uses these bindings to route inbound channel
     *  events to the right project's cage. When empty/undefined, the
     *  project has no channel rooms bound and isn't reachable from
     *  external channels — agent chat still works via the dashboard.
     *
     *  At most one binding per (channelId, roomId) pair (refined below).
     *  Reference: agi/docs/agents/channel-plugin-redesign.md §5. */
    rooms: z.array(ProjectRoomBindingSchema).optional(),
  })
  .passthrough() // Plugins can store custom keys at the root level
  .refine(
    (cfg) => !cfg.repos || cfg.repos.filter((r) => r.isDefault).length <= 1,
    { message: "at most one repo may be marked isDefault: true" },
  )
  .refine(
    (cfg) => {
      if (!cfg.repos) return true;
      // No two repos can share the same internal port (collision in
      // the shared container's localhost namespace).
      const ports = cfg.repos.filter((r) => r.port).map((r) => r.port);
      return new Set(ports).size === ports.length;
    },
    { message: "two or more repos share the same port — each repo's port must be unique inside the project's container" },
  )
  .refine(
    (cfg) => {
      if (!cfg.repos) return true;
      // No two repos can share the same externalPath.
      const paths = cfg.repos.filter((r) => r.externalPath).map((r) => r.externalPath);
      return new Set(paths).size === paths.length;
    },
    { message: "two or more repos share the same externalPath" },
  )
  .refine(
    (cfg) => {
      if (!cfg.rooms) return true;
      // No two rooms can share the same (channelId, roomId) pair.
      const keys = cfg.rooms.map((r) => `${r.channelId}::${r.roomId}`);
      return new Set(keys).size === keys.length;
    },
    { message: "two or more rooms share the same (channelId, roomId) binding — bindings must be unique per project" },
  );

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
export type ProjectMcpServer = z.infer<typeof ProjectMcpServerSchema>;
export type ProjectMcp = z.infer<typeof ProjectMcpSchema>;
export type ProjectRepo = z.infer<typeof ProjectRepoSchema>;
export type ProjectRoomBinding = z.infer<typeof ProjectRoomBindingSchema>;
