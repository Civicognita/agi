import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { PUBLIC_DIR } from "./index.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const DEFAULT_MIME = "application/octet-stream";

/**
 * Serve a static file from the public directory.
 * Returns true if the file was served, false if not found.
 */
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? "/";
  const pathname = url.split("?")[0] ?? "/";
  const filename = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");

  // Block directory traversal
  if (filename.includes("..")) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  const filePath = join(PUBLIC_DIR, filename);
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] ?? DEFAULT_MIME;

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/** Options for creating the WebChat HTTP server */
export interface WebChatServerOptions {
  port: number;
  host?: string;
}

/**
 * Create an HTTP server that serves the WebChat static files.
 * Returns the server instance — call `.listen()` to start, or pass to
 * GatewayWebSocketServer as the `server` option to share the port.
 */
export function createWebChatServer(): Server {
  const server = createServer(async (req, res) => {
    const served = await serveStatic(req, res);
    if (!served) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  return server;
}

/**
 * Start the WebChat HTTP server on the given port.
 * Returns the running server instance.
 */
export function startWebChatServer(options: WebChatServerOptions): Promise<Server> {
  const server = createWebChatServer();

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => {
      resolve(server);
    });
  });
}
