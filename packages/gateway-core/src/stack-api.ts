/**
 * Stack API routes — REST endpoints for stack management.
 */

import type { FastifyInstance } from "fastify";
import type { StackRegistry } from "./stack-registry.js";
import type { SharedContainerManager } from "./shared-container-manager.js";
import type { HostingManager } from "./hosting-manager.js";
import type { ProjectCategory } from "./project-types.js";
import type { StackCategory } from "./stack-types.js";
import type { ComponentLogger } from "./logger.js";
import type { RuntimeDefinition } from "@aionima/plugins";

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
