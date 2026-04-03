/**
 * WhatsApp Webhook Handler — Task #161
 *
 * HTTP handler for WhatsApp Cloud API webhooks.
 * Handles both:
 *   - GET: Webhook verification (hub.mode, hub.verify_token, hub.challenge)
 *   - POST: Inbound message processing
 *
 * Runs as part of the gateway HTTP server (not standalone).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyWebhookSignature } from "./security.js";
import { normalizeWebhook } from "./normalizer.js";
import type { WhatsAppWebhookPayload } from "./types.js";
import type { WhatsAppConfig } from "./config.js";
import type { AionimaMessage } from "@aionima/channel-sdk";
import type { ConversationWindowTracker } from "./outbound.js";

export interface WebhookHandlerDeps {
  config: WhatsAppConfig;
  windowTracker: ConversationWindowTracker;
  onMessages: (messages: AionimaMessage[]) => Promise<void>;
  /** Called with raw phone numbers before normalization (for reverse hash map). */
  onRawPhone?: (rawPhone: string) => void;
}

/**
 * Handle an incoming WhatsApp webhook request.
 *
 * @returns true if the request was handled, false if the path doesn't match.
 */
export async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebhookHandlerDeps,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (!url.pathname.endsWith("/webhook/whatsapp")) {
    return false;
  }

  if (req.method === "GET") {
    handleVerification(url, res, deps.config);
    return true;
  }

  if (req.method === "POST") {
    await handleInbound(req, res, deps);
    return true;
  }

  res.writeHead(405).end();
  return true;
}

// ---------------------------------------------------------------------------
// GET: Webhook verification
// ---------------------------------------------------------------------------

function handleVerification(
  url: URL,
  res: ServerResponse,
  config: WhatsAppConfig,
): void {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === config.verifyToken && challenge) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(challenge);
    return;
  }

  res.writeHead(403).end("Verification failed");
}

// ---------------------------------------------------------------------------
// POST: Inbound messages
// ---------------------------------------------------------------------------

async function handleInbound(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebhookHandlerDeps,
): Promise<void> {
  // Read raw body for signature verification
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(chunks);

  // Verify webhook signature
  const signature = req.headers["x-hub-signature-256"];
  if (typeof signature !== "string") {
    res.writeHead(401).end("Missing signature");
    return;
  }

  if (!verifyWebhookSignature(rawBody, signature, deps.config.appSecret)) {
    res.writeHead(401).end("Invalid signature");
    return;
  }

  // Acknowledge immediately (WhatsApp requires fast 200 response)
  res.writeHead(200).end();

  // Parse and process asynchronously
  try {
    const payload = JSON.parse(rawBody.toString("utf-8")) as WhatsAppWebhookPayload;

    if (payload.object !== "whatsapp_business_account") return;

    // Extract raw phone numbers before normalization (which hashes them)
    if (deps.onRawPhone) {
      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          if (change.field !== "messages") continue;
          for (const msg of change.value.messages ?? []) {
            deps.onRawPhone(msg.from);
          }
        }
      }
    }

    const messages = normalizeWebhook(payload, deps.config);

    // Record inbound messages for conversation window tracking
    for (const msg of messages) {
      deps.windowTracker.recordInbound(msg.channelUserId);
    }

    if (messages.length > 0) {
      await deps.onMessages(messages);
    }
  } catch {
    // Silently ignore parse errors — already sent 200 to WhatsApp
  }
}
