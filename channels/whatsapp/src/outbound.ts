/**
 * WhatsApp Outbound — Task #163
 *
 * Sends messages to WhatsApp via the Cloud API / 360dialog.
 * Handles the 24-hour messaging window constraint:
 *   - Within window: send freeform text/media
 *   - Outside window: fall back to pre-approved template messages
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 */

import type { OutboundContent } from "@agi/channel-sdk";
import type {
  WhatsAppSendRequest,
  WhatsAppSendResponse,
} from "./types.js";
import type { WhatsAppConfig } from "./config.js";

/** WhatsApp's maximum text message length. */
const MAX_TEXT_LENGTH = 4096;

// ---------------------------------------------------------------------------
// Conversation window tracking
// ---------------------------------------------------------------------------

/**
 * Tracks the 24-hour messaging window per user.
 * After a user sends a message, we have 24 hours to send freeform replies.
 */
export class ConversationWindowTracker {
  private readonly windows = new Map<string, number>();
  private readonly windowMs = 24 * 60 * 60 * 1000; // 24 hours

  /** Record that a user sent us a message (opens/extends the window). */
  recordInbound(hashedPhone: string): void {
    this.windows.set(hashedPhone, Date.now());
  }

  /** Check if we can send freeform messages to this user. */
  isWindowOpen(hashedPhone: string): boolean {
    const lastInbound = this.windows.get(hashedPhone);
    if (lastInbound === undefined) return false;
    return Date.now() - lastInbound < this.windowMs;
  }

  /** Remove expired windows (housekeeping). */
  cleanup(): void {
    const now = Date.now();
    for (const [phone, timestamp] of this.windows) {
      if (now - timestamp >= this.windowMs) {
        this.windows.delete(phone);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export interface WhatsAppApiClient {
  sendMessage(request: WhatsAppSendRequest): Promise<WhatsAppSendResponse>;
}

/**
 * Create a WhatsApp API client that sends messages via the Cloud API.
 */
export function createApiClient(config: WhatsAppConfig): WhatsAppApiClient {
  const baseUrl = config.apiBaseUrl ?? "https://graph.facebook.com";
  const version = config.apiVersion ?? "v21.0";
  const url = `${baseUrl}/${version}/${config.phoneNumberId}/messages`;

  return {
    sendMessage: async (request: WhatsAppSendRequest): Promise<WhatsAppSendResponse> => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `WhatsApp API error ${response.status}: ${body}`,
        );
      }

      return response.json() as Promise<WhatsAppSendResponse>;
    },
  };
}

// ---------------------------------------------------------------------------
// Outbound sender
// ---------------------------------------------------------------------------

/**
 * Send an OutboundContent payload to a WhatsApp user.
 *
 * If the 24-hour window is closed and a fallback template is configured,
 * sends a template message instead. Otherwise throws.
 */
export async function sendOutbound(
  api: WhatsAppApiClient,
  recipientPhone: string,
  content: OutboundContent,
  windowTracker: ConversationWindowTracker,
  config: WhatsAppConfig,
): Promise<void> {
  const windowOpen = windowTracker.isWindowOpen(recipientPhone);

  if (!windowOpen) {
    // Outside 24-hour window — try template fallback
    if (config.fallbackTemplateName) {
      const templateText = content.type === "text" ? content.text : (content.type === "media" ? (content.caption ?? "") : "");
      await sendTemplate(
        api,
        recipientPhone,
        config.fallbackTemplateName,
        config.fallbackTemplateLanguage ?? "en_US",
        templateText,
      );
      return;
    }

    throw new Error(
      `Cannot send to ${recipientPhone}: 24-hour messaging window closed and no fallback template configured`,
    );
  }

  // Within window — send freeform message
  if (content.type === "text") {
    const chunks = splitText(content.text, MAX_TEXT_LENGTH);
    for (const chunk of chunks) {
      await api.sendMessage({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientPhone,
        type: "text",
        text: { body: chunk },
      });
    }
    return;
  }

  if (content.type === "media") {
    if (content.mimeType.startsWith("image/")) {
      await api.sendMessage({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientPhone,
        type: "image",
        image: { link: content.url, caption: content.caption },
      });
    } else {
      await api.sendMessage({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientPhone,
        type: "document",
        document: { link: content.url, caption: content.caption },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Template message
// ---------------------------------------------------------------------------

async function sendTemplate(
  api: WhatsAppApiClient,
  recipientPhone: string,
  templateName: string,
  languageCode: string,
  bodyText: string,
): Promise<void> {
  await api.sendMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: bodyText.length > 0
        ? [{ type: "body", parameters: [{ type: "text", text: bodyText }] }]
        : [],
    },
  });
}

// ---------------------------------------------------------------------------
// Text splitting (same pattern as Telegram)
// ---------------------------------------------------------------------------

export function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
