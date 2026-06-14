/**
 * WhatsApp Config — Task #161
 *
 * Configuration and validation for the WhatsApp Business API adapter.
 * Supports both 360dialog aggregator and direct Cloud API access.
 */

// ---------------------------------------------------------------------------
// Config type
// ---------------------------------------------------------------------------

export interface WhatsAppConfig {
  /** WhatsApp Business API access token (360dialog or Cloud API). */
  accessToken: string;
  /** Phone number ID from WhatsApp Business Manager. */
  phoneNumberId: string;
  /** Webhook verification token (must match what's set in the dashboard). */
  verifyToken: string;
  /** App secret for webhook signature verification (HMAC-SHA256). */
  appSecret: string;
  /**
   * Base URL for the API. Defaults to Meta Cloud API.
   * Set to 360dialog endpoint if using aggregator.
   */
  apiBaseUrl?: string;
  /** API version (default: "v21.0"). */
  apiVersion?: string;
  /** Max messages per user per minute (default: 20). */
  rateLimitPerMinute?: number;
  /**
   * Template name for messages outside the 24-hour window.
   * If not set, messages outside the window will fail silently.
   */
  fallbackTemplateName?: string;
  /** Template language code (default: "en_US"). */
  fallbackTemplateLanguage?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isWhatsAppConfig(value: unknown): value is WhatsAppConfig {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj["accessToken"] !== "string" || obj["accessToken"].length === 0)
    return false;
  if (typeof obj["phoneNumberId"] !== "string" || obj["phoneNumberId"].length === 0)
    return false;
  if (typeof obj["verifyToken"] !== "string" || obj["verifyToken"].length === 0)
    return false;
  if (typeof obj["appSecret"] !== "string" || obj["appSecret"].length === 0)
    return false;

  if (
    "apiBaseUrl" in obj &&
    typeof obj["apiBaseUrl"] !== "string"
  ) return false;

  if (
    "apiVersion" in obj &&
    typeof obj["apiVersion"] !== "string"
  ) return false;

  if (
    "rateLimitPerMinute" in obj &&
    (typeof obj["rateLimitPerMinute"] !== "number" || obj["rateLimitPerMinute"] <= 0)
  ) return false;

  if (
    "fallbackTemplateName" in obj &&
    typeof obj["fallbackTemplateName"] !== "string"
  ) return false;

  if (
    "fallbackTemplateLanguage" in obj &&
    typeof obj["fallbackTemplateLanguage"] !== "string"
  ) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Config adapter
// ---------------------------------------------------------------------------

export function createConfigAdapter() {
  return {
    validate: (config: unknown) => isWhatsAppConfig(config),
    getDefaults: () => ({
      apiBaseUrl: "https://graph.facebook.com",
      apiVersion: "v21.0",
      rateLimitPerMinute: 20,
      fallbackTemplateLanguage: "en_US",
    }),
  };
}
