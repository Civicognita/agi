/**
 * WhatsApp Business API Types — Task #161
 *
 * Types for the WhatsApp Cloud API / 360dialog aggregator integration.
 * These mirror the official WhatsApp Business API webhook payloads
 * relevant to the aionima adapter.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */

// ---------------------------------------------------------------------------
// Webhook payload (inbound)
// ---------------------------------------------------------------------------

/** Top-level webhook notification from WhatsApp Cloud API. */
export interface WhatsAppWebhookPayload {
  object: "whatsapp_business_account";
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppChangeValue;
  field: "messages";
}

export interface WhatsAppChangeValue {
  messaging_product: "whatsapp";
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface WhatsAppMessageBase {
  from: string; // sender phone number
  id: string; // message ID (wamid.*)
  timestamp: string; // Unix timestamp as string
  context?: { message_id: string }; // reply context
}

export interface WhatsAppTextMessage extends WhatsAppMessageBase {
  type: "text";
  text: { body: string };
}

export interface WhatsAppImageMessage extends WhatsAppMessageBase {
  type: "image";
  image: {
    id: string;
    mime_type: string;
    sha256: string;
    caption?: string;
  };
}

export interface WhatsAppAudioMessage extends WhatsAppMessageBase {
  type: "audio";
  audio: {
    id: string;
    mime_type: string;
  };
}

export interface WhatsAppDocumentMessage extends WhatsAppMessageBase {
  type: "document";
  document: {
    id: string;
    mime_type: string;
    sha256: string;
    filename?: string;
    caption?: string;
  };
}

export interface WhatsAppReactionMessage extends WhatsAppMessageBase {
  type: "reaction";
  reaction: {
    message_id: string;
    emoji: string;
  };
}

export type WhatsAppMessage =
  | WhatsAppTextMessage
  | WhatsAppImageMessage
  | WhatsAppAudioMessage
  | WhatsAppDocumentMessage
  | WhatsAppReactionMessage;

// ---------------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------------

export interface WhatsAppStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: WhatsAppError[];
}

export interface WhatsAppError {
  code: number;
  title: string;
  message: string;
  error_data?: { details: string };
}

// ---------------------------------------------------------------------------
// Outbound (send message)
// ---------------------------------------------------------------------------

export interface WhatsAppSendTextRequest {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: { body: string };
}

export interface WhatsAppSendImageRequest {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "image";
  image: { link: string; caption?: string };
}

export interface WhatsAppSendDocumentRequest {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "document";
  document: { link: string; caption?: string; filename?: string };
}

export interface WhatsAppSendTemplateRequest {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: WhatsAppTemplateComponent[];
  };
}

export interface WhatsAppTemplateComponent {
  type: "body" | "header" | "button";
  parameters: Array<{
    type: "text" | "image" | "document";
    text?: string;
    image?: { link: string };
    document?: { link: string };
  }>;
}

export type WhatsAppSendRequest =
  | WhatsAppSendTextRequest
  | WhatsAppSendImageRequest
  | WhatsAppSendDocumentRequest
  | WhatsAppSendTemplateRequest;

export interface WhatsAppSendResponse {
  messaging_product: "whatsapp";
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}
