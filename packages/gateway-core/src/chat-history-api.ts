/**
 * Chat History API Routes — REST endpoints for browsing and managing persisted chat sessions.
 *
 * All endpoints are gated to private network only (same pattern as editor-api.ts).
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { ChatPersistence } from "./chat-persistence.js";

// ---------------------------------------------------------------------------
// Helpers (same pattern as editor-api.ts)
// ---------------------------------------------------------------------------

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

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0];
    return first !== undefined ? first.trim() : "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatHistoryRouteDeps {
  chatPersistence: ChatPersistence;
  imageBlobStore?: import("./image-blob-store.js").ImageBlobStore;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerChatHistoryRoutes(
  fastify: FastifyInstance,
  deps: ChatHistoryRouteDeps,
): void {
  const { chatPersistence, imageBlobStore } = deps;

  // GET /api/chat/sessions — list all saved sessions
  fastify.get("/api/chat/sessions", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Private network only" });
    }

    const sessions = chatPersistence.list();
    return { sessions };
  });

  // GET /api/chat/sessions/:id — load a full persisted session
  fastify.get("/api/chat/sessions/:id", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Private network only" });
    }

    const { id } = request.params as { id: string };
    const session = chatPersistence.load(id);
    if (session === null) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return session;
  });

  // GET /api/chat/images/:sessionId/:imageId — serve an image from the blob store
  fastify.get("/api/chat/images/:sessionId/:imageId", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Private network only" });
    }

    if (!imageBlobStore) {
      return reply.code(501).send({ error: "Image blob store not available" });
    }

    const { sessionId, imageId } = request.params as { sessionId: string; imageId: string };
    const blob = imageBlobStore.load(sessionId, imageId);
    if (!blob) {
      return reply.code(404).send({ error: "Image not found" });
    }

    const buffer = Buffer.from(blob.data, "base64");
    return reply
      .header("Content-Type", blob.mediaType)
      .header("Content-Length", buffer.length)
      .header("Cache-Control", "public, max-age=86400")
      .send(buffer);
  });

  // DELETE /api/chat/sessions/:id — delete a saved session
  fastify.delete("/api/chat/sessions/:id", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) {
      return reply.code(403).send({ error: "Private network only" });
    }

    const { id } = request.params as { id: string };
    const deleted = chatPersistence.delete(id);
    if (deleted) imageBlobStore?.deleteSession(id);
    return { ok: deleted };
  });
}
