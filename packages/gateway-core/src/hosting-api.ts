/**
 * Hosting API Routes — Fastify route registration for project hosting.
 *
 * All endpoints are gated to private network only.
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath, join } from "node:path";
import type { HostingManager, ProjectHostingMeta } from "./hosting-manager.js";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes from command output so the dashboard renders clean text. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07/g;
function stripAnsi(text: string): string { return text.replace(ANSI_RE, ""); }

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isPrivateNetwork(ip: string): boolean {
  if (isLoopback(ip)) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (ip.startsWith("fe80:")) return true;
  return false;
}

function getClientIp(req: IncomingMessage & { ip?: string }): string {
  // Use Fastify's req.ip when available — it handles proxy trust correctly
  // based on the trustProxy configuration. Only fall back to raw socket address.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface HostingRouteDeps {
  hostingManager: HostingManager;
  workspaceProjects: string[];
  logger?: Logger;
  notificationStore?: { create(params: { type: string; title: string; body: string; metadata?: unknown }): unknown };
}

export interface PortalTool {
  id: string;
  name: string;
  description: string;
  url: string;
  icon?: string;
}

export function registerHostingRoutes(
  fastify: FastifyInstance,
  deps: HostingRouteDeps,
): { registerPortalTool: (tool: PortalTool) => void } {
  const { hostingManager, workspaceProjects } = deps;
  const log = createComponentLogger(deps.logger, "hosting-api");

  // Host-based routing: db.{baseDomain} serves the DB portal at /
  const dbHost = `db.${hostingManager.getStatus().baseDomain}`;
  fastify.addHook("onRequest", async (request, reply) => {
    const host = (request.headers.host ?? "").split(":")[0];
    if (host === dbHost && (request.url === "/" || request.url === "")) {
      return reply.redirect("/db-portal");
    }
  });

  // Private network guard helper
  function guardPrivate(request: { raw: IncomingMessage }): string | null {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return "Hosting API only allowed from private network";
    return null;
  }

  // Path validation helper
  function validateProjectPath(path: string): string | null {
    const resolved = resolvePath(path);
    const isInWorkspace = workspaceProjects.some((dir) => resolved.startsWith(resolvePath(dir)));
    if (!isInWorkspace) return "Path is not inside a configured workspace.projects directory";
    return null;
  }

  // -----------------------------------------------------------------------
  // GET /api/hosting/status — infrastructure readiness + all hosted projects
  // -----------------------------------------------------------------------

  fastify.get("/api/hosting/status", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    return reply.send(hostingManager.getStatus());
  });

  // -----------------------------------------------------------------------
  // GET /api/hosting/setup — trigger hosting-setup.sh (SSE stream)
  // -----------------------------------------------------------------------

  fastify.get("/api/hosting/setup", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const scriptPath = resolvePath(process.cwd(), "scripts/hosting-setup.sh");
    log.info(`running hosting setup (streaming): ${scriptPath}`);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const child = spawn("sudo", ["bash", "-x", scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const send = (type: string, text: string) => {
      reply.raw.write(`data: ${JSON.stringify({ type, text })}\n\n`);
    };

    child.stdout.on("data", (data: Buffer) => {
      send("stdout", data.toString());
    });

    child.stderr.on("data", (data: Buffer) => {
      send("stderr", data.toString());
    });

    child.on("close", (code) => {
      send("exit", String(code ?? 0));
      log.info(`hosting setup finished with code ${String(code)}`);
      reply.raw.end();
    });

    child.on("error", (childErr) => {
      send("error", childErr.message);
      log.error(`hosting setup spawn error: ${childErr.message}`);
      reply.raw.end();
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/enable — enable hosting for a project
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/enable", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as {
      path?: string;
      type?: string;
      hostname?: string;
      docRoot?: string;
      startCommand?: string;
      mode?: "production" | "development";
      internalPort?: number;
      runtimeId?: string;
    };

    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }

    const pathErr = validateProjectPath(body.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    const resolved = resolvePath(body.path);
    const slug = resolved.split("/").pop()?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "project";

    const detected = hostingManager.detectProjectDefaults(resolved);

    const meta: ProjectHostingMeta = {
      enabled: true,
      type: body.type ?? detected.projectType,
      hostname: body.hostname ?? slug,
      docRoot: body.docRoot ?? detected.docRoot,
      startCommand: body.startCommand ?? detected.startCommand,
      port: null,
      mode: body.mode ?? "production",
      internalPort: body.internalPort ?? null,
      runtimeId: body.runtimeId ?? null,
    };

    try {
      await hostingManager.enableProject(resolved, meta);
      hostingManager.regenerateCaddyfile();
      const hosting = hostingManager.getProjectHostingInfo(resolved);
      if (hosting?.status === "error" && hosting.error) {
        log.error(`hosting enable failed for ${meta.hostname}: ${hosting.error}`);
        deps.notificationStore?.create({
          type: "hosting-error",
          title: `Hosting failed: ${meta.hostname}`,
          body: hosting.error,
          metadata: { projectPath: resolved, action: "enable" },
        });
      }
      return reply.send({ ok: true, hosting });
    } catch (enableErr) {
      const message = enableErr instanceof Error ? enableErr.message : String(enableErr);
      log.error(`hosting enable exception for ${meta.hostname}: ${message}`);
      deps.notificationStore?.create({
        type: "hosting-error",
        title: `Hosting failed: ${meta.hostname}`,
        body: message,
        metadata: { projectPath: resolved, action: "enable" },
      });
      return reply.code(500).send({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/disable — disable hosting for a project
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/disable", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as { path?: string };
    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }

    const pathErr = validateProjectPath(body.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    try {
      await hostingManager.disableProject(body.path);
      return reply.send({ ok: true });
    } catch (disableErr) {
      const message = disableErr instanceof Error ? disableErr.message : String(disableErr);
      return reply.code(500).send({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // PUT /api/hosting/configure — update hosting config for a project
  // -----------------------------------------------------------------------

  fastify.put("/api/hosting/configure", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as {
      path?: string;
      type?: string;
      hostname?: string;
      docRoot?: string;
      startCommand?: string;
      mode?: "production" | "development";
      internalPort?: number;
      runtimeId?: string;
    };

    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }

    const pathErr = validateProjectPath(body.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    const updates: Partial<Omit<ProjectHostingMeta, "enabled">> = {};
    if (body.type !== undefined) updates.type = body.type;
    if (body.hostname !== undefined) updates.hostname = body.hostname;
    if (body.docRoot !== undefined) updates.docRoot = body.docRoot;
    if (body.startCommand !== undefined) updates.startCommand = body.startCommand;
    if (body.mode !== undefined) updates.mode = body.mode;
    if (body.internalPort !== undefined) updates.internalPort = body.internalPort;
    if (body.runtimeId !== undefined) updates.runtimeId = body.runtimeId;

    try {
      const hosted = await hostingManager.configureProject(body.path, updates);
      if (!hosted) {
        return reply.code(404).send({ error: "Project not hosted" });
      }
      return reply.send({
        ok: true,
        hosting: hostingManager.getProjectHostingInfo(body.path),
      });
    } catch (configErr) {
      const message = configErr instanceof Error ? configErr.message : String(configErr);
      return reply.code(500).send({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/restart — restart a hosted project container
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/restart", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as { path?: string };
    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }

    const pathErr = validateProjectPath(body.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    const restarted = hostingManager.restartProject(body.path);
    if (!restarted) {
      return reply.code(400).send({ error: "Project is not currently hosted" });
    }

    const hosting = hostingManager.getProjectHostingInfo(body.path);
    if (hosting?.status === "error" && hosting.error) {
      log.error(`hosting restart failed for ${hosting.hostname}: ${hosting.error}`);
      deps.notificationStore?.create({
        type: "hosting-error",
        title: `Restart failed: ${hosting.hostname}`,
        body: hosting.error,
        metadata: { projectPath: resolvePath(body.path), action: "restart" },
      });
      return reply.code(500).send({ ok: false, error: hosting.error, hosting });
    }

    return reply.send({ ok: true, hosting });
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/tunnel/enable — start a Cloudflare quick tunnel
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/tunnel/enable", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as { path?: string };
    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }

    const pathErr = validateProjectPath(body.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    try {
      const resolved = resolvePath(body.path);
      const result = await hostingManager.enableTunnel(resolved);
      return reply.send({ ok: true, tunnelUrl: result.url });
    } catch (tunnelErr) {
      const message = tunnelErr instanceof Error ? tunnelErr.message : String(tunnelErr);
      return reply.code(500).send({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/tunnel/disable — stop a Cloudflare quick tunnel
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/tunnel/disable", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as { path?: string };
    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }

    const pathErr = validateProjectPath(body.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    try {
      const resolved = resolvePath(body.path);
      hostingManager.disableTunnel(resolved);
      return reply.send({ ok: true });
    } catch (tunnelErr) {
      const message = tunnelErr instanceof Error ? tunnelErr.message : String(tunnelErr);
      return reply.code(500).send({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/hosting/cloudflared/status — check cloudflared binary + auth status
  // -----------------------------------------------------------------------

  fastify.get("/api/hosting/cloudflared/status", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });
    return reply.send(hostingManager.getCloudflaredStatus());
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/cloudflared/login — start interactive Cloudflare auth flow
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/cloudflared/login", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const { loginUrl, waitForCompletion } = await hostingManager.startCloudflaredLogin();

      // Return the URL immediately — the UI will poll /cloudflared/status for completion
      void reply.send({ ok: true, loginUrl });

      // Fire and forget: the completion promise cleans up the child process
      waitForCompletion.then((result) => {
        if (result.success) {
          log.info("cloudflared login completed successfully");
        } else {
          log.warn(`cloudflared login failed: ${result.error ?? "unknown"}`);
        }
      }).catch(() => { /* ignore */ });
    } catch (loginErr) {
      const message = loginErr instanceof Error ? loginErr.message : String(loginErr);
      return reply.code(500).send({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/cloudflared/logout — revoke Cloudflare auth (remove cert.pem)
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/cloudflared/logout", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });
    return reply.send(hostingManager.revokeCloudflaredAuth());
  });

  // -----------------------------------------------------------------------
  // GET /api/hosting/logs — retrieve container logs for a project
  // -----------------------------------------------------------------------

  fastify.get("/api/hosting/logs", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const query = request.query as { path?: string; tail?: string; source?: string };
    if (!query.path || typeof query.path !== "string") {
      return reply.code(400).send({ error: "path query parameter is required" });
    }

    const pathErr = validateProjectPath(query.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    const tail = query.tail !== undefined ? Math.max(1, Math.min(10_000, Number(query.tail) || 100)) : 100;

    let sourceType: "container" | "container-file" = "container";
    let containerFilePath: string | undefined;

    if (query.source && query.source !== "container") {
      const meta = hostingManager.readHostingMeta(query.path);
      const registry = hostingManager.getProjectTypeRegistry();
      const typeDef = registry?.get(meta?.type ?? "");
      const logSource = typeDef?.logSources?.find(s => s.id === query.source);
      if (!logSource) {
        return reply.code(404).send({ error: `Unknown log source: ${query.source}` });
      }
      sourceType = logSource.type;
      containerFilePath = logSource.containerPath;
    }

    const logs = hostingManager.getContainerLogs(query.path, tail, sourceType, containerFilePath);

    if (logs === null) {
      return reply.code(404).send({ error: "No container found for this project" });
    }

    return reply.send({ logs });
  });

  // -----------------------------------------------------------------------
  // GET /api/hosting/log-sources — return available log sources for a project
  // -----------------------------------------------------------------------

  fastify.get("/api/hosting/log-sources", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const query = request.query as { path?: string };
    if (!query.path || typeof query.path !== "string") {
      return reply.code(400).send({ error: "path query parameter is required" });
    }

    const pathErr = validateProjectPath(query.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    const meta = hostingManager.readHostingMeta(query.path);
    const registry = hostingManager.getProjectTypeRegistry();
    const typeDef = registry?.get(meta?.type ?? "");
    const sources = typeDef?.logSources ?? [{ id: "container", label: "Container Output", type: "container" }];
    return reply.send({ sources });
  });

  // -----------------------------------------------------------------------
  // GET /api/hosting/project-types — return the project type registry
  // -----------------------------------------------------------------------

  fastify.get("/api/hosting/project-types", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const registry = hostingManager.getProjectTypeRegistry();
    if (!registry) {
      return reply.send({ types: [] });
    }
    return reply.send({ types: registry.toJSON() });
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/tools/:toolId — execute a project type tool
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/tools/:toolId", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const { toolId } = request.params as { toolId: string };
    const body = request.body as { path?: string };
    if (!body.path || typeof body.path !== "string") {
      return reply.code(400).send({ error: "path is required" });
    }

    const pathErr = validateProjectPath(body.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    const registry = hostingManager.getProjectTypeRegistry();
    if (!registry) {
      return reply.code(500).send({ error: "Project type registry not available" });
    }

    // Read the project's type from its meta
    const meta = hostingManager.readHostingMeta(body.path);
    const projectType = meta?.type ?? "static";
    const typeDef = registry.get(projectType);
    if (!typeDef) {
      return reply.code(404).send({ error: `Unknown project type: ${projectType}` });
    }

    // Check project type tools first, then stack tools and dev commands
    let tool = typeDef.tools.find((t) => t.id === toolId);

    if (!tool) {
      // Check dev commands from installed stacks (prefixed with "dev-cmd-")
      if (toolId.startsWith("dev-cmd-")) {
        const cmdKey = toolId.slice("dev-cmd-".length);
        const devCommands = hostingManager.getProjectDevCommands(body.path);
        const cmd = devCommands[cmdKey];
        if (cmd) {
          tool = { id: toolId, label: cmdKey, description: cmd, action: "shell", command: cmd };
        }
      }
      // Check stack tools
      if (!tool) {
        const stacks = hostingManager.getProjectStacks(body.path);
        const stackRegistry = hostingManager.getStackRegistry();
        for (const inst of stacks) {
          const def = stackRegistry?.get(inst.stackId);
          if (def) {
            const stackTool = def.tools.find((t) => t.id === toolId);
            if (stackTool) { tool = stackTool; break; }
          }
        }
      }
    }

    if (!tool) {
      return reply.code(404).send({ error: `Tool "${toolId}" not found for type "${projectType}"` });
    }

    if (tool.action !== "shell" || !tool.command) {
      return reply.code(400).send({ error: `Tool "${toolId}" is not a shell action` });
    }

    // Execute the tool command — inside the running container if available,
    // otherwise on the host in the project directory
    const resolved = resolvePath(body.path);
    const containerName = hostingManager.getContainerName(body.path);

    // Build a clean env that won't leak the gateway's NODE_ENV into containers.
    // For container exec we only pass TERM for color support; the container
    // already has its own environment from podman run.
    const hostEnv = { ...process.env };
    delete hostEnv.NODE_ENV;

    try {
      let output: string;
      if (containerName) {
        const meta = hostingManager.readHostingMeta(body.path);
        const nodeEnv = meta?.mode ?? "production";
        output = execSync(
          `podman exec -e NODE_ENV=${nodeEnv} -e TERM=xterm-256color ${containerName} sh -c ${JSON.stringify(tool.command)}`,
          { timeout: 60_000, stdio: "pipe" },
        ).toString();
      } else {
        output = execSync(tool.command, {
          cwd: resolved,
          timeout: 60_000,
          stdio: "pipe",
          env: hostEnv,
        }).toString();
      }
      return reply.send({ ok: true, output: stripAnsi(output) });
    } catch (toolErr) {
      const message = toolErr instanceof Error ? toolErr.message : String(toolErr);
      return reply.code(500).send({ error: stripAnsi(message) });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/hosting/client-setup/:os — serve DNS setup scripts with baked config
  // -----------------------------------------------------------------------

  const OS_SCRIPT_MAP: Record<string, { file: string; contentType: string; filename: string }> = {
    linux:   { file: "client-dns-setup.sh",  contentType: "text/x-shellscript",  filename: "client-dns-setup.sh" },
    macos:   { file: "client-dns-setup.sh",  contentType: "text/x-shellscript",  filename: "client-dns-setup.sh" },
    windows: { file: "client-dns-setup.ps1", contentType: "text/plain",          filename: "client-dns-setup.ps1" },
  };

  fastify.get("/api/hosting/client-setup/:os", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const { os } = request.params as { os: string };
    const entry = OS_SCRIPT_MAP[os.toLowerCase()];
    if (!entry) {
      return reply.code(400).send({ error: `Unsupported OS: ${os}. Use linux, macos, or windows.` });
    }

    const scriptPath = resolvePath(process.cwd(), "scripts", entry.file);
    let script: string;
    try {
      script = readFileSync(scriptPath, "utf-8");
    } catch {
      return reply.code(500).send({ error: `Script not found: ${entry.file}` });
    }

    const cfg = hostingManager.getConfig();
    script = script
      .replaceAll("__AIONIMA_IP__", cfg.lanIp)
      .replaceAll("__NEXUS_IP__", cfg.lanIp)  // legacy backwards compat
      .replaceAll("__BASE_DOMAIN__", cfg.baseDomain);

    return reply
      .header("Content-Type", entry.contentType)
      .header("Content-Disposition", `attachment; filename="${entry.filename}"`)
      .send(script);
  });

  // -----------------------------------------------------------------------
  // GET /api/hosting/ca-cert — serve the Caddy internal CA root certificate
  // -----------------------------------------------------------------------

  fastify.get("/api/hosting/ca-cert", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const caPath = "/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt";
    let cert: string;
    try {
      cert = readFileSync(caPath, "utf-8");
    } catch {
      return reply.code(404).send({ error: "CA certificate not found. HTTPS may not have been used yet." });
    }

    return reply
      .header("Content-Type", "application/x-pem-file")
      .header("Content-Disposition", "attachment; filename=\"aionima-ca.crt\"")
      .send(cert);
  });

  // -------------------------------------------------------------------------
  // Database Portal — system-level DB management page at db.ai.on
  // -------------------------------------------------------------------------

  const portalTools: PortalTool[] = [];

  const registerPortalTool = (tool: PortalTool): void => {
    const idx = portalTools.findIndex((t) => t.id === tool.id);
    if (idx >= 0) {
      portalTools[idx] = tool;
    } else {
      portalTools.push(tool);
    }
  };

  function escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function generatePortalHtml(tools: PortalTool[]): string {
    const cards = tools
      .map((t) => `
    <a href="${escapeHtml(t.url)}" class="card">
      <div class="card-icon">${escapeHtml(t.icon ?? "🗄️")}</div>
      <div class="card-name">${escapeHtml(t.name)}</div>
      <div class="card-desc">${escapeHtml(t.description)}</div>
    </a>`)
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aionima — Database Portal</title>
  <style>
    :root {
      --ctp-base: #1e1e2e; --ctp-mantle: #181825; --ctp-surface0: #313244;
      --ctp-text: #cdd6f4; --ctp-subtext0: #a6adc8; --ctp-blue: #89b4fa;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--ctp-base); color: var(--ctp-text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 3rem 1rem; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    .subtitle { color: var(--ctp-subtext0); font-size: 0.875rem; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; max-width: 800px; width: 100%; }
    .card { background: var(--ctp-mantle); border: 1px solid var(--ctp-surface0); border-radius: 12px; padding: 1.5rem; text-decoration: none; color: var(--ctp-text); transition: border-color 0.2s, transform 0.15s; }
    .card:hover { border-color: var(--ctp-blue); transform: translateY(-2px); }
    .card-icon { font-size: 2rem; margin-bottom: 0.75rem; }
    .card-name { font-weight: 600; margin-bottom: 0.25rem; }
    .card-desc { font-size: 0.8rem; color: var(--ctp-subtext0); }
    .empty { color: var(--ctp-subtext0); font-size: 0.875rem; text-align: center; padding: 3rem 1rem; }
  </style>
</head>
<body>
  <h1>Database Portal</h1>
  <p class="subtitle">Aionima database management tools</p>
  <div class="grid">
    ${cards || '<div class="empty">No database tools registered yet.</div>'}
  </div>
</body>
</html>`;
  }

  // GET /db-portal — portal HTML page
  fastify.get("/db-portal", async (_request, reply) => {
    const html = generatePortalHtml(portalTools);
    return reply.header("Content-Type", "text/html; charset=utf-8").send(html);
  });

  // GET /api/db-portal/tools — list registered tools
  fastify.get("/api/db-portal/tools", async (_request, reply) => {
    return reply.send({ tools: portalTools });
  });

  // POST /api/db-portal/register — plugins register their tools here
  fastify.post("/api/db-portal/register", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as Partial<PortalTool> | null;
    if (!body?.id || !body.name || !body.url) {
      return reply.code(400).send({ error: "Missing required fields: id, name, url" });
    }
    registerPortalTool({
      id: body.id,
      name: body.name,
      description: body.description ?? "",
      url: body.url,
      icon: body.icon,
    });
    return reply.send({ ok: true });
  });

  // -----------------------------------------------------------------------
  // GET /api/hosting/env — read .env file for a project
  // -----------------------------------------------------------------------

  fastify.get("/api/hosting/env", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const query = request.query as { path?: string };
    if (!query.path) return reply.code(400).send({ error: "path query parameter required" });

    const pathErr = validateProjectPath(query.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    const envPath = join(resolvePath(query.path), ".env");
    if (!existsSync(envPath)) return reply.send({ vars: {} });

    try {
      const content = readFileSync(envPath, "utf-8");
      const vars: Record<string, string> = {};
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (key) vars[key] = value;
      }
      return reply.send({ vars });
    } catch (readErr) {
      return reply.code(500).send({ error: readErr instanceof Error ? readErr.message : String(readErr) });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/hosting/env — write .env file for a project
  // -----------------------------------------------------------------------

  fastify.post("/api/hosting/env", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as { path?: string; vars?: Record<string, string> };
    if (!body.path || !body.vars || typeof body.vars !== "object") {
      return reply.code(400).send({ error: "path and vars are required" });
    }

    const pathErr = validateProjectPath(body.path);
    if (pathErr) return reply.code(403).send({ error: pathErr });

    const envPath = join(resolvePath(body.path), ".env");
    const content = Object.entries(body.vars)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, value]) => {
        if (/[\s#"'\\]/.test(value)) {
          return `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        }
        return `${key}=${value}`;
      })
      .join("\n") + "\n";

    try {
      writeFileSync(envPath, content, "utf-8");
      return reply.send({ ok: true });
    } catch (writeErr) {
      return reply.code(500).send({ error: writeErr instanceof Error ? writeErr.message : String(writeErr) });
    }
  });

  return { registerPortalTool };
}
