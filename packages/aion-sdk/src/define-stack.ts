/**
 * defineStack — chainable builder for StackDefinition.
 *
 * Stacks are composable bundles that provide runtime, database, tooling,
 * framework, or workflow capabilities to projects. They replace the deprecated
 * `registerHostingExtension()` with a semantic, structured system.
 *
 * ## Quick example
 *
 * ```ts
 * const pgStack = defineStack("stack-postgres-17", "PostgreSQL 17")
 *   .description("PostgreSQL 17 — latest stable")
 *   .category("database")
 *   .projectCategories(["app", "web"])
 *   .requirement({ id: "postgresql", label: "PostgreSQL 17", type: "provided" })
 *   .guide({ title: "Connection", content: "Use the connection URL..." })
 *   .container({
 *     image: "postgres:17-alpine",
 *     internalPort: 5432,
 *     shared: true,
 *     sharedKey: "postgres-17",
 *     volumeMounts: () => ["pg17-data:/var/lib/postgresql/data"],
 *     env: () => ({ POSTGRES_PASSWORD: "aionima-root" }),
 *     healthCheck: "pg_isready -U postgres",
 *   })
 *   .database({
 *     engine: "postgresql",
 *     rootUser: "postgres",
 *     rootPasswordEnvVar: "POSTGRES_PASSWORD",
 *     setupScript: (ctx) => ["psql", "-U", "postgres", "-c", `CREATE USER ...`],
 *     teardownScript: (ctx) => ["psql", "-U", "postgres", "-c", `DROP USER ...`],
 *     connectionUrlTemplate: "postgresql://{user}:{password}@localhost:{port}/{database}",
 *   })
 *   .tool({ id: "psql", label: "psql", description: "Open psql shell", action: "shell", command: "psql -U {user}" })
 *   .icon("database")
 *   .build();
 *
 * // In your plugin's activate():
 * api.registerStack(pgStack);
 * ```
 *
 * ## Stack categories
 *
 * | Category    | Purpose                                 |
 * |-------------|-----------------------------------------|
 * | `runtime`   | Programming language version            |
 * | `database`  | Shared database container               |
 * | `tooling`   | Development tools                       |
 * | `framework` | Framework-specific configuration        |
 * | `workflow`  | Automated processes                     |
 *
 * ## Shared containers
 *
 * Database stacks with `shared: true` in their `containerConfig` share a single
 * container across all projects. Set `sharedKey` to a unique identifier
 * (e.g. `"postgres-17"`). The `SharedContainerManager` handles lifecycle:
 * - First project to add the stack starts the container
 * - Each project gets its own database, user, and password
 * - Removing the last project stops the container
 *
 * ## Requirements
 *
 * Requirements declare what a stack provides or expects:
 * - `type: "provided"` — this stack brings this capability
 * - `type: "expected"` — another stack must provide this
 *
 * The StackPicker warns on conflicts (two stacks providing the same requirement).
 */

import type {
  StackDefinition,
  StackCategory,
  StackRequirement,
  StackGuide,
  StackContainerConfig,
  StackDatabaseConfig,
  StackScaffoldingConfig,
  StackInstallAction,
  StackDevCommands,
} from "@aionima/gateway-core";
import type { ProjectCategory, ProjectTypeTool } from "@aionima/gateway-core";

class StackBuilder {
  private def: Partial<StackDefinition> & {
    requirements: StackRequirement[];
    guides: StackGuide[];
    tools: ProjectTypeTool[];
  };

  constructor(id: string, label: string) {
    this.def = { id, label, requirements: [], guides: [], tools: [] };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  category(cat: StackCategory): this {
    this.def.category = cat;
    return this;
  }

  projectCategories(cats: ProjectCategory[]): this {
    this.def.projectCategories = cats;
    return this;
  }

  requirement(req: StackRequirement): this {
    this.def.requirements.push(req);
    return this;
  }

  guide(guide: StackGuide): this {
    this.def.guides.push(guide);
    return this;
  }

  container(config: StackContainerConfig): this {
    this.def.containerConfig = config;
    return this;
  }

  database(config: StackDatabaseConfig): this {
    this.def.databaseConfig = config;
    return this;
  }

  scaffolding(config: StackScaffoldingConfig): this {
    this.def.scaffolding = config;
    return this;
  }

  tool(tool: ProjectTypeTool): this {
    this.def.tools.push(tool);
    return this;
  }

  installAction(action: StackInstallAction): this {
    if (!this.def.installActions) this.def.installActions = [];
    this.def.installActions.push(action);
    return this;
  }

  devCommands(commands: StackDevCommands): this {
    this.def.devCommands = commands;
    return this;
  }

  icon(icon: string): this {
    this.def.icon = icon;
    return this;
  }

  build(): StackDefinition {
    if (!this.def.description) throw new Error("StackDefinition requires a description");
    if (!this.def.category) throw new Error("StackDefinition requires a category");
    if (!this.def.projectCategories) throw new Error("StackDefinition requires projectCategories");
    return this.def as StackDefinition;
  }
}

/**
 * Create a stack definition using a chainable builder.
 *
 * @param id - Unique stack identifier (e.g. "stack-postgres-17")
 * @param label - Human-readable label (e.g. "PostgreSQL 17")
 */
export function defineStack(id: string, label: string): StackBuilder {
  return new StackBuilder(id, label);
}
