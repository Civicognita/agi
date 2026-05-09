/**
 * Stack API routes — REST endpoints for stack management.
 */

import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import type { FastifyInstance } from "fastify";
import type { StackRegistry } from "./stack-registry.js";
import type { SharedContainerManager } from "./shared-container-manager.js";
import type { HostingManager } from "./hosting-manager.js";
import type { ProjectCategory } from "./project-types.js";
import { filterStackActionsForRepo } from "./stack-types.js";
import type { StackCategory } from "./stack-types.js";
import type { ComponentLogger } from "./logger.js";
import type { RuntimeDefinition } from "@agi/plugins";

export interface PluginRegistryLike {
  getRuntimes(): RuntimeDefinition[];
}

export interface StackApiDeps {
  stackRegistry: StackRegistry;
  sharedContainerManager: SharedContainerManager;
  hostingManager: HostingManager;
  log: ComponentLogger;
  pluginRegistry?: PluginRegistryLike;
}

export function registerStackRoutes(app: FastifyInstance, deps: StackApiDeps): void {
  const { stackRegistry, sharedContainerManager, hostingManager, log } = deps;

  // GET /api/stacks — list all stacks, optionally filtered
  app.get("/api/stacks", async (request, reply) => {
    const query = request.query as { category?: string; stackCategory?: string };
    const stacks = stackRegistry.toJSON({
      projectCategory: query.category as ProjectCategory | undefined,
      stackCategory: query.stackCategory as StackCategory | undefined,
    });
    reply.send({ stacks });
  });

  // GET /api/stacks/for-repo — catalog filtered by the repo's effective
  // project category (s141 t555). When attaching a stack to a specific
  // repo, the dashboard hits this to cut menu noise — only stacks
  // compatible with the project's classification surface. The "all"
  // toggle on the dashboard side just falls back to /api/stacks
  // (unfiltered).
  //
  // Response includes `inferredCategory` so the dashboard can label the
  // filter ("Showing for App — view all") without a second call. When
  // the project type can't be resolved (no projectTypeRegistry, project
  // type unset, registry doesn't know the type), returns the full
  // catalog + `inferredCategory: null` — caller fall-through is the
  // same code path as the toggle-off case.
  app.get("/api/stacks/for-repo", async (request, reply) => {
    const query = request.query as { path?: string; repo?: string };
    if (!query.path) {
      reply.code(400).send({ error: "path query parameter required" });
      return;
    }

    let inferredCategory: ProjectCategory | null = null;
    const cfg = (hostingManager as unknown as {
      configMgr: { read(p: string): { type?: string } | null } | undefined;
    }).configMgr?.read(query.path);
    const typeId = cfg?.type;
    const projectTypeRegistry = hostingManager.getProjectTypeRegistry();
    if (typeId && projectTypeRegistry) {
      const def = projectTypeRegistry.get(typeId);
      if (def?.category) inferredCategory = def.category;
    }

    const stacks = stackRegistry.toJSON({
      projectCategory: inferredCategory ?? undefined,
    });
    reply.send({ stacks, inferredCategory, projectType: typeId ?? null });
  });

  // GET /api/stacks/:id — single stack detail
  app.get("/api/stacks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const def = stackRegistry.get(id);
    if (!def) {
      reply.code(404).send({ error: "Stack not found" });
      return;
    }
    const [info] = stackRegistry.toJSON();
    const match = stackRegistry.toJSON().find((s) => s.id === id);
    reply.send({ stack: match ?? info });
  });

  // POST /api/hosting/stacks/add — add a stack to a project
  app.post("/api/hosting/stacks/add", async (request, reply) => {
    const body = request.body as { path?: string; stackId?: string } | undefined;
    if (!body?.path || !body?.stackId) {
      reply.code(400).send({ error: "path and stackId required" });
      return;
    }

    const def = stackRegistry.get(body.stackId);
    if (!def) {
      reply.code(404).send({ error: `Stack "${body.stackId}" not found` });
      return;
    }

    try {
      const instance = await hostingManager.addStack(body.path, body.stackId);
      reply.send({ ok: true, stack: instance });
    } catch (err) {
      log.error(`addStack failed: ${err instanceof Error ? err.message : String(err)}`);
      reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/hosting/stacks/remove — remove a stack from a project
  app.post("/api/hosting/stacks/remove", async (request, reply) => {
    const body = request.body as { path?: string; stackId?: string } | undefined;
    if (!body?.path || !body?.stackId) {
      reply.code(400).send({ error: "path and stackId required" });
      return;
    }

    try {
      await hostingManager.removeStack(body.path, body.stackId);
      reply.send({ ok: true });
    } catch (err) {
      log.error(`removeStack failed: ${err instanceof Error ? err.message : String(err)}`);
      reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/hosting/stacks/run-action — re-run a single install action
  app.post("/api/hosting/stacks/run-action", async (request, reply) => {
    const body = request.body as { path?: string; stackId?: string; actionId?: string } | undefined;
    if (!body?.path || !body?.stackId || !body?.actionId) {
      reply.code(400).send({ error: "path, stackId, and actionId required" });
      return;
    }

    try {
      const result = await hostingManager.runStackAction(body.path, body.stackId, body.actionId);
      reply.send(result);
    } catch (err) {
      log.error(`runStackAction failed: ${err instanceof Error ? err.message : String(err)}`);
      reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/hosting/stacks/dev-commands — aggregated dev commands for a project
  app.get("/api/hosting/stacks/dev-commands", async (request, reply) => {
    const query = request.query as { path?: string };
    if (!query.path) {
      reply.code(400).send({ error: "path query parameter required" });
      return;
    }

    const commands = hostingManager.getProjectDevCommands(query.path);
    reply.send({ commands });
  });

  // GET /api/hosting/stacks/start-command — effective start command + source for a project.
  // Shows the UI which command the container will actually run at boot, which tier of the
  // precedence ladder picked it (override / stack.command / devCommands / image-default),
  // and what the stack's default would be if the user cleared the override.
  app.get("/api/hosting/stacks/start-command", async (request, reply) => {
    const query = request.query as { path?: string };
    if (!query.path) {
      reply.code(400).send({ error: "path query parameter required" });
      return;
    }

    reply.send(hostingManager.getEffectiveStartCommand(query.path));
  });

  // GET /api/hosting/stacks — list stacks installed on a project
  app.get("/api/hosting/stacks", async (request, reply) => {
    const query = request.query as { path?: string };
    if (!query.path) {
      reply.code(400).send({ error: "path query parameter required" });
      return;
    }

    const stacks = hostingManager.getProjectStacks(query.path);
    reply.send({ stacks });
  });

  // GET /api/hosting/stacks/actions — list stack install actions visible to a
  // specific repo within a project (s141 t553). Filters each stack's
  // installActions through `whenRepo({projectPath, repoName, repoCount})`.
  // When `repo` is omitted, returns the project-level surface
  // (`repoName: ""`) — preserves the legacy stack-card actions list.
  app.get("/api/hosting/stacks/actions", async (request, reply) => {
    const query = request.query as { path?: string; repo?: string };
    if (!query.path) {
      reply.code(400).send({ error: "path query parameter required" });
      return;
    }

    const projectPath = query.path;
    const repoName = query.repo ?? "";
    const instances = hostingManager.getProjectStacks(projectPath);
    // Count repos via the existing config-manager accessor (no new method
    // on HostingManager). projectConfigManager isn't directly on
    // StackApiDeps, so route through hostingManager which holds it.
    const repoCount = (hostingManager as unknown as {
      configMgr: { getRepos(p: string): unknown[] } | undefined;
    }).configMgr?.getRepos(projectPath).length ?? 0;
    const ctx = { projectPath, repoName, repoCount };

    const result = instances.map((instance) => {
      const def = stackRegistry.get(instance.stackId);
      const actions = def ? filterStackActionsForRepo(def.installActions, ctx) : [];
      return {
        stackId: instance.stackId,
        actions: actions.map(({ id, label, description, optional }) => ({
          id, label, description, optional,
        })),
      };
    });

    reply.send({ stacks: result, repoCount });
  });

  // GET /api/stacks/compatible-runtimes — runtimes filtered by installed stacks' compatibleLanguages
  app.get("/api/stacks/compatible-runtimes", async (request, reply) => {
    const query = request.query as { projectPath?: string };
    if (!query.projectPath) {
      reply.code(400).send({ error: "projectPath query parameter required" });
      return;
    }

    const allRuntimes = deps.pluginRegistry?.getRuntimes() ?? [];
    const instances = hostingManager.getProjectStacks(query.projectPath);

    const compatibleLanguages = new Set<string>();
    for (const instance of instances) {
      const def = stackRegistry.get(instance.stackId);
      if (def?.compatibleLanguages) {
        for (const lang of def.compatibleLanguages) {
          compatibleLanguages.add(lang);
        }
      }
    }

    const runtimes = compatibleLanguages.size > 0
      ? allRuntimes.filter((r) => compatibleLanguages.has(r.language))
      : allRuntimes;

    reply.send({ runtimes });
  });

  // GET /api/hosting/database-engines — list database engines available for the Database card
  app.get("/api/hosting/database-engines", async (_request, reply) => {
    const allStacks = stackRegistry.getAll();
    const dbStacks = allStacks.filter(s => s.category === "database");

    // Build a set of running shared container sharedKeys for O(1) lookup
    const runningKeys = new Set(
      sharedContainerManager.getAll()
        .filter(c => c.status === "running")
        .map(c => c.sharedKey),
    );

    const engines = dbStacks.map(stack => {
      const image = stack.containerConfig?.image ?? "";
      const imageAvailable = image !== "" && (() => {
        try {
          execFileSync("podman", ["image", "exists", image], { stdio: "pipe", timeout: 5_000 });
          return true;
        } catch {
          return false;
        }
      })();

      const sharedKey = stack.containerConfig?.sharedKey;
      const containerRunning = sharedKey !== undefined && runningKeys.has(sharedKey);

      return {
        stackId: stack.id,
        engine: stack.databaseConfig?.engine ?? stack.id,
        label: stack.label,
        description: stack.description,
        imageAvailable,
        containerRunning,
        port: stack.containerConfig?.internalPort ?? 0,
      };
    }).filter(e => e.imageAvailable);

    // Prepend the "file" default option (always available, no container needed)
    const result = [
      {
        stackId: "file",
        engine: "file",
        label: "File (default)",
        description: "SQLite or whatever the project defaults to",
        imageAvailable: true,
        containerRunning: true,
        port: 0,
      },
      ...engines,
    ];

    return reply.send(result);
  });

  // GET /api/hosting/database-detect — auto-detect database engine from project files
  app.get("/api/hosting/database-detect", async (request, reply) => {
    const query = request.query as { path?: string };
    if (!query.path) {
      reply.code(400).send({ error: "path required" });
      return;
    }

    const resolved = resolvePath(query.path);

    // prisma/schema.prisma
    try {
      const prisma = readFileSync(join(resolved, "prisma", "schema.prisma"), "utf-8");
      if (prisma.includes('provider = "postgresql"')) {
        return reply.send({ detectedEngine: "postgresql", reason: "prisma/schema.prisma" });
      }
      if (prisma.includes('provider = "mysql"')) {
        return reply.send({ detectedEngine: "mysql", reason: "prisma/schema.prisma" });
      }
      if (prisma.includes('provider = "sqlite"')) {
        return reply.send({ detectedEngine: "sqlite", reason: "prisma/schema.prisma" });
      }
    } catch { /* not found */ }

    // drizzle.config.ts / drizzle.config.js
    for (const name of ["drizzle.config.ts", "drizzle.config.js"]) {
      try {
        const drizzle = readFileSync(join(resolved, name), "utf-8");
        if (drizzle.includes("pg") || drizzle.includes("postgres")) {
          return reply.send({ detectedEngine: "postgresql", reason: name });
        }
        if (drizzle.includes("mysql")) {
          return reply.send({ detectedEngine: "mysql", reason: name });
        }
        if (drizzle.includes("sqlite") || drizzle.includes("better-sqlite")) {
          return reply.send({ detectedEngine: "sqlite", reason: name });
        }
      } catch { /* not found */ }
    }

    // config/database.yml (Rails-style)
    try {
      const dbYml = readFileSync(join(resolved, "config", "database.yml"), "utf-8");
      if (dbYml.includes("adapter: postgresql") || dbYml.includes("adapter: pg")) {
        return reply.send({ detectedEngine: "postgresql", reason: "config/database.yml" });
      }
      if (dbYml.includes("adapter: mysql") || dbYml.includes("adapter: mysql2")) {
        return reply.send({ detectedEngine: "mysql", reason: "config/database.yml" });
      }
      if (dbYml.includes("adapter: sqlite")) {
        return reply.send({ detectedEngine: "sqlite", reason: "config/database.yml" });
      }
    } catch { /* not found */ }

    // config/database.php (Laravel/Symfony)
    try {
      const dbPhp = readFileSync(join(resolved, "config", "database.php"), "utf-8");
      if (dbPhp.includes("pgsql") || dbPhp.includes("postgresql")) {
        return reply.send({ detectedEngine: "postgresql", reason: "config/database.php" });
      }
      if (dbPhp.includes("mysql")) {
        return reply.send({ detectedEngine: "mysql", reason: "config/database.php" });
      }
      if (dbPhp.includes("sqlite")) {
        return reply.send({ detectedEngine: "sqlite", reason: "config/database.php" });
      }
    } catch { /* not found */ }

    // composer.json — PHP dependency hints
    try {
      const composer = readFileSync(join(resolved, "composer.json"), "utf-8");
      if (composer.includes("ext-pdo_pgsql") || composer.includes("doctrine/dbal")) {
        return reply.send({ detectedEngine: "postgresql", reason: "composer.json" });
      }
      if (composer.includes("ext-pdo_mysql")) {
        return reply.send({ detectedEngine: "mysql", reason: "composer.json" });
      }
    } catch { /* not found */ }

    // .env.example / .env — DATABASE_URL or DB_CONNECTION
    for (const envFile of [".env.example", ".env"]) {
      try {
        const env = readFileSync(join(resolved, envFile), "utf-8");
        if (env.includes("postgresql://") || env.includes("postgres://")) {
          return reply.send({ detectedEngine: "postgresql", reason: envFile });
        }
        if (env.includes("mysql://")) {
          return reply.send({ detectedEngine: "mysql", reason: envFile });
        }
        const dbConn = env.match(/DB_CONNECTION\s*=\s*(\S+)/);
        if (dbConn?.[1]) {
          const driver = dbConn[1].toLowerCase();
          if (driver.includes("pgsql") || driver.includes("postgres")) {
            return reply.send({ detectedEngine: "postgresql", reason: envFile });
          }
          if (driver.includes("mysql")) {
            return reply.send({ detectedEngine: "mysql", reason: envFile });
          }
          if (driver.includes("sqlite")) {
            return reply.send({ detectedEngine: "sqlite", reason: envFile });
          }
        }
      } catch { /* not found */ }
    }

    return reply.send({ detectedEngine: null, reason: "no database configuration detected" });
  });

  // POST /api/hosting/database-migrate — detect migration tool and run it in the project container
  app.post("/api/hosting/database-migrate", async (request, reply) => {
    const body = request.body as { path?: string } | null;
    if (!body?.path) {
      reply.code(400).send({ error: "path required" });
      return;
    }

    const resolved = resolvePath(body.path);
    const containerName = hostingManager.getContainerName(resolved);
    if (!containerName) {
      reply.code(404).send({ error: "No running container for this project" });
      return;
    }

    // Detect migration tool from package.json or composer.json
    let cmd: string | null = null;

    try {
      const pkg = readFileSync(join(resolved, "package.json"), "utf-8");
      if (pkg.includes("prisma")) {
        cmd = "npx prisma migrate deploy";
      } else if (pkg.includes("drizzle-kit")) {
        cmd = "npx drizzle-kit migrate";
      }
    } catch { /* not a node project */ }

    if (!cmd) {
      try {
        const composer = readFileSync(join(resolved, "composer.json"), "utf-8");
        if (composer.includes("laravel")) {
          cmd = "php artisan migrate --force";
        }
      } catch { /* not a php project */ }
    }

    if (!cmd) {
      reply.code(400).send({ error: "No migration tool detected (checked: prisma, drizzle-kit, artisan)" });
      return;
    }

    try {
      const output = execSync(`podman exec ${containerName} sh -c '${cmd}'`, {
        encoding: "utf-8",
        timeout: 60_000,
        stdio: "pipe",
      });
      return reply.send({ ok: true, tool: cmd, output: output.trim() });
    } catch (err) {
      const msg = err instanceof Error ? ((err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? err.message) : String(err);
      return reply.send({ ok: false, tool: cmd, error: msg });
    }
  });

  // GET /api/hosting/database-storage — disk usage for database volumes
  app.get("/api/hosting/database-storage", async (request, reply) => {
    const query = request.query as { path?: string };

    const results: { projectBytes: number | null; totalBytes: number | null; volumeName: string | null } = {
      projectBytes: null,
      totalBytes: null,
      volumeName: null,
    };

    // If a project path is given, look up which shared container it uses and
    // try to surface just that volume's usage as projectBytes.
    if (query.path) {
      const resolved = resolvePath(query.path);
      const stacks = hostingManager.getProjectStacks(resolved);
      for (const instance of stacks) {
        const def = stackRegistry.get(instance.stackId);
        const sharedKey = def?.containerConfig?.sharedKey;
        if (!sharedKey) continue;
        const containerName = sharedContainerManager.getContainerName(sharedKey);
        if (!containerName) continue;
        try {
          const mountPoint = execSync(
            `podman volume inspect agi-shared-${sharedKey} --format '{{.Mountpoint}}'`,
            { encoding: "utf-8", stdio: "pipe", timeout: 10_000 },
          ).trim();
          if (mountPoint) {
            const sizeOut = execSync(`du -sb ${mountPoint} 2>/dev/null`, {
              encoding: "utf-8",
              stdio: "pipe",
              timeout: 10_000,
            }).trim();
            results.projectBytes = parseInt(sizeOut.split("\t")[0] ?? "0", 10);
            results.volumeName = `agi-shared-${sharedKey}`;
          }
        } catch { /* volume not found or du failed */ }
        break; // only report first database stack
      }
    }

    // Aggregate all agi-shared-* database volumes for totalBytes
    try {
      const volumesRaw = execSync("podman volume ls --format '{{.Name}}'", {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 10_000,
      }).trim();

      const volumes = volumesRaw
        .split("\n")
        .map((v) => v.trim())
        .filter((v) =>
          v.includes("postgres") || v.includes("mariadb") || v.includes("mysql") ||
          v.includes("redis") || v.includes("pgdata") || v.includes("agi-shared-"),
        );

      let total = 0;
      for (const vol of volumes) {
        try {
          const mountPoint = execSync(
            `podman volume inspect ${vol} --format '{{.Mountpoint}}'`,
            { encoding: "utf-8", stdio: "pipe", timeout: 10_000 },
          ).trim();
          const sizeOut = execSync(`du -sb ${mountPoint} 2>/dev/null`, {
            encoding: "utf-8",
            stdio: "pipe",
            timeout: 10_000,
          }).trim();
          total += parseInt(sizeOut.split("\t")[0] ?? "0", 10);
          if (!results.volumeName) results.volumeName = vol;
        } catch { /* skip this volume */ }
      }

      if (total > 0) results.totalBytes = total;
    } catch { /* podman not available or no volumes */ }

    return reply.send(results);
  });

  // GET /api/hosting/database-test — test database connectivity from the project container
  app.get("/api/hosting/database-test", async (request, reply) => {
    const query = request.query as { path?: string };
    if (!query.path) {
      reply.code(400).send({ error: "path required" });
      return;
    }

    const resolved = resolvePath(query.path);
    const containerName = hostingManager.getContainerName(resolved);
    if (!containerName) {
      return reply.send({ ok: false, error: "No running container" });
    }

    // Try to read DATABASE_URL from the project's .env
    let dbUrl = "";
    try {
      const env = readFileSync(join(resolved, ".env"), "utf-8");
      const match = env.match(/DATABASE_URL\s*=\s*(.+)/);
      if (match?.[1]) dbUrl = match[1].trim();
    } catch { /* no .env */ }

    if (!dbUrl) {
      return reply.send({ ok: false, error: "No DATABASE_URL in .env" });
    }

    // Test TCP connectivity from inside the project container to the database host/port
    try {
      const url = new URL(dbUrl);
      const host = url.hostname;
      const port = url.port || (url.protocol.includes("postgres") ? "5432" : url.protocol.includes("mysql") ? "3306" : "5432");
      execSync(
        `podman exec ${containerName} sh -c "timeout 3 bash -c '</dev/tcp/${host}/${port}' 2>/dev/null"`,
        { encoding: "utf-8", timeout: 10_000, stdio: "pipe" },
      );
      return reply.send({ ok: true });
    } catch {
      return reply.send({ ok: false, error: "Cannot reach database from project container" });
    }
  });

  // GET /api/shared-containers — list all shared containers
  app.get("/api/shared-containers", async (_request, reply) => {
    reply.send({ containers: sharedContainerManager.getAll() });
  });

  // GET /api/shared-containers/:key/connection — per-project connection info
  app.get("/api/shared-containers/:key/connection", async (request, reply) => {
    const { key } = request.params as { key: string };
    const query = request.query as { project?: string };
    if (!query.project) {
      reply.code(400).send({ error: "project query parameter required" });
      return;
    }

    // Look up project stack instance to get credentials
    const stacks = hostingManager.getProjectStacks(query.project);
    const stackInstance = stacks.find((s) => {
      const def = stackRegistry.get(s.stackId);
      return def?.containerConfig?.sharedKey === key;
    });

    if (!stackInstance || !stackInstance.databaseName || !stackInstance.databaseUser || !stackInstance.databasePassword) {
      reply.code(404).send({ error: "No database connection found for this project and shared container" });
      return;
    }

    const info = sharedContainerManager.getConnectionInfo(
      key,
      query.project,
      stackInstance.databaseName,
      stackInstance.databaseUser,
      stackInstance.databasePassword,
    );

    if (!info) {
      reply.code(404).send({ error: "Shared container not found" });
      return;
    }

    reply.send(info);
  });
}
