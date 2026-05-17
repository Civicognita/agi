import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { isWhatsAppConfig, createConfigAdapter } from "./config.js";
import {
  WHATSAPP_CHANNEL_ID,
  hashPhoneNumber,
  normalizeWebhook,
  normalizeMessage,
  mediaUrl,
} from "./normalizer.js";
import {
  splitText,
  ConversationWindowTracker,
  sendOutbound,
} from "./outbound.js";
import type { WhatsAppApiClient } from "./outbound.js";
import {
  verifyWebhookSignature,
  createSecurityAdapter,
  hashPhoneForAllowlist,
} from "./security.js";
import { handleWebhook } from "./webhook.js";
import { createWhatsAppPlugin } from "./index.js";
import type {
  WhatsAppWebhookPayload,
  WhatsAppSendRequest,
  WhatsAppSendResponse,
} from "./types.js";
import type { WhatsAppConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_CONFIG: WhatsAppConfig = {
  accessToken: "EAAtest123",
  phoneNumberId: "12345678901",
  verifyToken: "my-verify-token",
  appSecret: "my-app-secret",
};

const FULL_CONFIG: WhatsAppConfig = {
  accessToken: "EAAtest123",
  phoneNumberId: "12345678901",
  verifyToken: "my-verify-token",
  appSecret: "my-app-secret",
  apiBaseUrl: "https://graph.facebook.com",
  apiVersion: "v21.0",
  rateLimitPerMinute: 30,
  fallbackTemplateName: "hello_world",
  fallbackTemplateLanguage: "en_US",
};

/** Build a minimal valid WhatsApp text message webhook payload. */
function textPayload(phone: string, text: string, msgId = "wamid.001"): WhatsAppWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "+1234567890", phone_number_id: "12345678901" },
              contacts: [{ wa_id: phone, profile: { name: "Test User" } }],
              messages: [
                {
                  from: phone,
                  id: msgId,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Build a mock API client that records calls. */
function mockApiClient(
  response: Partial<WhatsAppSendResponse> = {},
): { client: WhatsAppApiClient; calls: WhatsAppSendRequest[] } {
  const calls: WhatsAppSendRequest[] = [];
  const client: WhatsAppApiClient = {
    sendMessage: vi.fn(async (req: WhatsAppSendRequest) => {
      calls.push(req);
      return {
        messaging_product: "whatsapp",
        contacts: [{ input: "1234567890", wa_id: "1234567890" }],
        messages: [{ id: "wamid.sent-001" }],
        ...response,
      } as WhatsAppSendResponse;
    }),
  };
  return { client, calls };
}

/** Sign a body with HMAC-SHA256 using a secret. */
function signBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Build a mock IncomingMessage for webhook tests. */
function mockRequest(
  method: string,
  url: string,
  body: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const readable = Readable.from([body]);
  return Object.assign(readable, {
    method,
    url,
    headers,
  }) as unknown as IncomingMessage;
}

/** Build a mock ServerResponse that captures status code and body. */
function mockResponse(): ServerResponse & {
  statusCode: number;
  body: string;
  headersSent: boolean;
} {
  let statusCode = 200;
  let body = "";
  const headers: Record<string, string> = {};

  const res = {
    statusCode,
    body,
    headersSent: false,
    writeHead: vi.fn((code: number, hdrs?: Record<string, string>) => {
      statusCode = code;
      res.statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
      return res;
    }),
    end: vi.fn((data?: string) => {
      body = data ?? "";
      res.body = body;
      res.headersSent = true;
      return res;
    }),
    setHeader: vi.fn(),
    getHeader: vi.fn(() => undefined),
  } as unknown as ServerResponse & { statusCode: number; body: string; headersSent: boolean };

  return res;
}

// ---------------------------------------------------------------------------
// 1. config.ts — isWhatsAppConfig
// ---------------------------------------------------------------------------

describe("isWhatsAppConfig", () => {
  it("accepts a minimal valid config with required fields only", () => {
    expect(isWhatsAppConfig(VALID_CONFIG)).toBe(true);
  });

  it("accepts a fully-specified valid config", () => {
    expect(isWhatsAppConfig(FULL_CONFIG)).toBe(true);
  });

  it("rejects null", () => {
    expect(isWhatsAppConfig(null)).toBe(false);
  });

  it("rejects a string primitive", () => {
    expect(isWhatsAppConfig("token")).toBe(false);
  });

  it("rejects a number primitive", () => {
    expect(isWhatsAppConfig(42)).toBe(false);
  });

  it("rejects an empty object", () => {
    expect(isWhatsAppConfig({})).toBe(false);
  });

  it("rejects missing accessToken", () => {
    const { accessToken: _a, ...rest } = VALID_CONFIG;
    expect(isWhatsAppConfig(rest)).toBe(false);
  });

  it("rejects empty accessToken", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, accessToken: "" })).toBe(false);
  });

  it("rejects non-string accessToken", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, accessToken: 123 })).toBe(false);
  });

  it("rejects missing phoneNumberId", () => {
    const { phoneNumberId: _p, ...rest } = VALID_CONFIG;
    expect(isWhatsAppConfig(rest)).toBe(false);
  });

  it("rejects empty phoneNumberId", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, phoneNumberId: "" })).toBe(false);
  });

  it("rejects missing verifyToken", () => {
    const { verifyToken: _v, ...rest } = VALID_CONFIG;
    expect(isWhatsAppConfig(rest)).toBe(false);
  });

  it("rejects empty verifyToken", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, verifyToken: "" })).toBe(false);
  });

  it("rejects missing appSecret", () => {
    const { appSecret: _s, ...rest } = VALID_CONFIG;
    expect(isWhatsAppConfig(rest)).toBe(false);
  });

  it("rejects empty appSecret", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, appSecret: "" })).toBe(false);
  });

  it("rejects non-string apiBaseUrl when present", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, apiBaseUrl: 42 })).toBe(false);
  });

  it("accepts string apiBaseUrl when present", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, apiBaseUrl: "https://partner.360dialog.com" })).toBe(true);
  });

  it("rejects non-string apiVersion when present", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, apiVersion: 21 })).toBe(false);
  });

  it("rejects zero rateLimitPerMinute", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, rateLimitPerMinute: 0 })).toBe(false);
  });

  it("rejects negative rateLimitPerMinute", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, rateLimitPerMinute: -5 })).toBe(false);
  });

  it("rejects non-numeric rateLimitPerMinute", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, rateLimitPerMinute: "20" })).toBe(false);
  });

  it("accepts positive numeric rateLimitPerMinute", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, rateLimitPerMinute: 10 })).toBe(true);
  });

  it("rejects non-string fallbackTemplateName when present", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, fallbackTemplateName: 99 })).toBe(false);
  });

  it("accepts string fallbackTemplateName when present", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, fallbackTemplateName: "hello_world" })).toBe(true);
  });

  it("rejects non-string fallbackTemplateLanguage when present", () => {
    expect(isWhatsAppConfig({ ...VALID_CONFIG, fallbackTemplateLanguage: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 1b. config.ts — createConfigAdapter
// ---------------------------------------------------------------------------

describe("createConfigAdapter", () => {
  const adapter = createConfigAdapter();

  it("validate returns true for a valid config", () => {
    expect(adapter.validate(VALID_CONFIG)).toBe(true);
  });

  it("validate returns false for an invalid config (missing appSecret)", () => {
    const { appSecret: _s, ...rest } = VALID_CONFIG;
    expect(adapter.validate(rest)).toBe(false);
  });

  it("validate returns false for null", () => {
    expect(adapter.validate(null)).toBe(false);
  });

  it("getDefaults returns apiBaseUrl pointing to Meta graph API", () => {
    expect(adapter.getDefaults()).toMatchObject({
      apiBaseUrl: "https://graph.facebook.com",
    });
  });

  it("getDefaults returns apiVersion v21.0", () => {
    expect(adapter.getDefaults()).toMatchObject({ apiVersion: "v21.0" });
  });

  it("getDefaults returns rateLimitPerMinute: 20", () => {
    expect(adapter.getDefaults()).toMatchObject({ rateLimitPerMinute: 20 });
  });

  it("getDefaults returns fallbackTemplateLanguage: en_US", () => {
    expect(adapter.getDefaults()).toMatchObject({ fallbackTemplateLanguage: "en_US" });
  });
});

// ---------------------------------------------------------------------------
// 2. normalizer.ts — WHATSAPP_CHANNEL_ID
// ---------------------------------------------------------------------------

describe("WHATSAPP_CHANNEL_ID", () => {
  it('is the string "whatsapp"', () => {
    expect(WHATSAPP_CHANNEL_ID).toBe("whatsapp");
  });
});

// ---------------------------------------------------------------------------
// 2b. normalizer.ts — hashPhoneNumber
// ---------------------------------------------------------------------------

describe("hashPhoneNumber", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const result = hashPhoneNumber("+14155552671");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is consistent — same input produces same hash", () => {
    const phone = "+12125550100";
    expect(hashPhoneNumber(phone)).toBe(hashPhoneNumber(phone));
  });

  it("produces different hashes for different phone numbers", () => {
    expect(hashPhoneNumber("+14155551234")).not.toBe(hashPhoneNumber("+14155555678"));
  });

  it("matches node:crypto SHA-256 computation directly", () => {
    const phone = "+14155552671";
    const expected = createHash("sha256").update(phone).digest("hex");
    expect(hashPhoneNumber(phone)).toBe(expected);
  });

  it("hashes an empty string without throwing", () => {
    expect(() => hashPhoneNumber("")).not.toThrow();
    expect(hashPhoneNumber("")).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// 2c. normalizer.ts — mediaUrl
// ---------------------------------------------------------------------------

describe("mediaUrl", () => {
  it("builds URL with default base and version when config fields are absent", () => {
    const url = mediaUrl("media-id-abc", {});
    expect(url).toBe("https://graph.facebook.com/v21.0/media-id-abc");
  });

  it("builds URL using provided apiBaseUrl and apiVersion", () => {
    const url = mediaUrl("media-id-xyz", {
      apiBaseUrl: "https://waba.360dialog.io",
      apiVersion: "v19.0",
    });
    expect(url).toBe("https://waba.360dialog.io/v19.0/media-id-xyz");
  });
});

// ---------------------------------------------------------------------------
// 2d. normalizer.ts — normalizeMessage (single message)
// ---------------------------------------------------------------------------

describe("normalizeMessage", () => {
  const cfg = { apiBaseUrl: "https://graph.facebook.com", apiVersion: "v21.0" };
  const emptyContactMap = new Map<string, string>();

  it("normalizes a text message to type:text", () => {
    const msg = {
      from: "+14155550100",
      id: "wamid.001",
      timestamp: "1700000000",
      type: "text" as const,
      text: { body: "hello" },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("text");
    if (result!.content.type === "text") {
      expect(result!.content.text).toBe("hello");
    }
  });

  it("sets correct top-level fields for a text message", () => {
    const msg = {
      from: "+14155550100",
      id: "wamid.abc",
      timestamp: "1700000000",
      type: "text" as const,
      text: { body: "hi" },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result!.id).toBe("wamid.abc");
    expect(result!.channelId).toBe("whatsapp");
    expect(result!.channelUserId).toHaveLength(64); // SHA-256 hash
    expect(result!.timestamp).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("stores hashed phone (not plaintext) in channelUserId", () => {
    const phone = "+14155550100";
    const msg = {
      from: phone,
      id: "wamid.001",
      timestamp: "1700000000",
      type: "text" as const,
      text: { body: "test" },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result!.channelUserId).not.toBe(phone);
    expect(result!.channelUserId).toBe(hashPhoneNumber(phone));
  });

  it("normalizes an image message to type:media with correct mimeType", () => {
    const msg = {
      from: "+1234567890",
      id: "wamid.img",
      timestamp: "1700000001",
      type: "image" as const,
      image: { id: "img-media-id", mime_type: "image/jpeg", sha256: "abc123", caption: "A photo" },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("media");
    if (result!.content.type === "media") {
      expect(result!.content.mimeType).toBe("image/jpeg");
      expect(result!.content.caption).toBe("A photo");
      expect(result!.content.url).toContain("img-media-id");
    }
  });

  it("normalizes an audio message to type:voice with zero duration", () => {
    const msg = {
      from: "+1234567890",
      id: "wamid.audio",
      timestamp: "1700000002",
      type: "audio" as const,
      audio: { id: "audio-media-id", mime_type: "audio/ogg; codecs=opus" },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("voice");
    if (result!.content.type === "voice") {
      expect(result!.content.url).toContain("audio-media-id");
      expect(result!.content.duration).toBe(0);
    }
  });

  it("normalizes a document message to type:media", () => {
    const msg = {
      from: "+1234567890",
      id: "wamid.doc",
      timestamp: "1700000003",
      type: "document" as const,
      document: {
        id: "doc-media-id",
        mime_type: "application/pdf",
        sha256: "def456",
        filename: "report.pdf",
        caption: "Q3 report",
      },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result).not.toBeNull();
    expect(result!.content.type).toBe("media");
    if (result!.content.type === "media") {
      expect(result!.content.mimeType).toBe("application/pdf");
      expect(result!.content.caption).toBe("Q3 report");
    }
  });

  it("returns null for a reaction message (unsupported type)", () => {
    const msg = {
      from: "+1234567890",
      id: "wamid.react",
      timestamp: "1700000004",
      type: "reaction" as const,
      reaction: { message_id: "wamid.001", emoji: "👍" },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result).toBeNull();
  });

  it("sets replyTo when context.message_id is present", () => {
    const msg = {
      from: "+1234567890",
      id: "wamid.reply",
      timestamp: "1700000005",
      type: "text" as const,
      text: { body: "reply" },
      context: { message_id: "wamid.original" },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result!.replyTo).toBe("wamid.original");
  });

  it("leaves replyTo undefined when context is absent", () => {
    const msg = {
      from: "+1234567890",
      id: "wamid.standalone",
      timestamp: "1700000006",
      type: "text" as const,
      text: { body: "standalone" },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result!.replyTo).toBeUndefined();
  });

  it("populates metadata with displayName from contactMap", () => {
    const phone = "+14155550100";
    const contactMap = new Map([[phone, "Alice Wonderland"]]);
    const msg = {
      from: phone,
      id: "wamid.named",
      timestamp: "1700000007",
      type: "text" as const,
      text: { body: "named user" },
    };
    const result = normalizeMessage(msg, contactMap, cfg);
    expect(result!.metadata?.displayName).toBe("Alice Wonderland");
  });

  it("leaves displayName undefined when phone not in contactMap", () => {
    const msg = {
      from: "+9999999999",
      id: "wamid.unknown",
      timestamp: "1700000008",
      type: "text" as const,
      text: { body: "unknown" },
    };
    const result = normalizeMessage(msg, emptyContactMap, cfg);
    expect(result!.metadata?.displayName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2e. normalizer.ts — normalizeWebhook (full payload)
// ---------------------------------------------------------------------------

describe("normalizeWebhook", () => {
  const cfg = { apiBaseUrl: "https://graph.facebook.com", apiVersion: "v21.0" };

  it("returns an empty array for a payload with no messages field", () => {
    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "e1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+1", phone_number_id: "1" },
                statuses: [
                  { id: "wamid.001", status: "delivered", timestamp: "1700000000", recipient_id: "+1" },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(normalizeWebhook(payload, cfg)).toHaveLength(0);
  });

  it("returns an empty array for a payload with empty entry list", () => {
    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [],
    };
    expect(normalizeWebhook(payload, cfg)).toHaveLength(0);
  });

  it("returns an empty array for a payload with empty messages array", () => {
    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "e1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+1", phone_number_id: "1" },
                messages: [],
              },
            },
          ],
        },
      ],
    };
    expect(normalizeWebhook(payload, cfg)).toHaveLength(0);
  });

  it("normalizes a single text message from a payload", () => {
    const payload = textPayload("+14155550100", "hello world");
    const results = normalizeWebhook(payload, cfg);
    expect(results).toHaveLength(1);
    expect(results[0]!.content.type).toBe("text");
    if (results[0]!.content.type === "text") {
      expect(results[0]!.content.text).toBe("hello world");
    }
  });

  it("normalizes multiple messages from a single payload", () => {
    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "e1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+1", phone_number_id: "1" },
                contacts: [
                  { wa_id: "+14155550100", profile: { name: "Alice" } },
                  { wa_id: "+12125550200", profile: { name: "Bob" } },
                ],
                messages: [
                  { from: "+14155550100", id: "wamid.a", timestamp: "1700000000", type: "text", text: { body: "msg1" } },
                  { from: "+12125550200", id: "wamid.b", timestamp: "1700000001", type: "text", text: { body: "msg2" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const results = normalizeWebhook(payload, cfg);
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("wamid.a");
    expect(results[1]!.id).toBe("wamid.b");
  });

  it("skips reaction messages and returns only supported messages", () => {
    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "e1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+1", phone_number_id: "1" },
                messages: [
                  { from: "+1234567890", id: "wamid.txt", timestamp: "1700000000", type: "text", text: { body: "hi" } },
                  { from: "+1234567890", id: "wamid.rct", timestamp: "1700000001", type: "reaction", reaction: { message_id: "wamid.txt", emoji: "❤️" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const results = normalizeWebhook(payload, cfg);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("wamid.txt");
  });

  it("processes multiple entries from a single payload", () => {
    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "e1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+1", phone_number_id: "1" },
                messages: [
                  { from: "+111", id: "wamid.e1", timestamp: "1700000000", type: "text", text: { body: "entry1" } },
                ],
              },
            },
          ],
        },
        {
          id: "e2",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+1", phone_number_id: "1" },
                messages: [
                  { from: "+222", id: "wamid.e2", timestamp: "1700000001", type: "text", text: { body: "entry2" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const results = normalizeWebhook(payload, cfg);
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. outbound.ts — ConversationWindowTracker
// ---------------------------------------------------------------------------

describe("ConversationWindowTracker", () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;
  let fakeNow: number;

  beforeEach(() => {
    fakeNow = 1_000_000_000;
    dateSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it("returns false for a user who has never sent a message", () => {
    const tracker = new ConversationWindowTracker();
    expect(tracker.isWindowOpen("unknown-hash")).toBe(false);
  });

  it("returns true immediately after recordInbound", () => {
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("user-hash-abc");
    expect(tracker.isWindowOpen("user-hash-abc")).toBe(true);
  });

  it("returns true just before the 24-hour window expires", () => {
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("user-hash-abc");
    // Advance 23 hours and 59 minutes
    fakeNow += (24 * 60 * 60 * 1000) - 60_000;
    expect(tracker.isWindowOpen("user-hash-abc")).toBe(true);
  });

  it("returns false exactly at 24 hours after last inbound", () => {
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("user-hash-abc");
    fakeNow += 24 * 60 * 60 * 1000;
    expect(tracker.isWindowOpen("user-hash-abc")).toBe(false);
  });

  it("returns false after 24 hours have passed", () => {
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("user-hash-abc");
    fakeNow += 24 * 60 * 60 * 1000 + 1;
    expect(tracker.isWindowOpen("user-hash-abc")).toBe(false);
  });

  it("extends the window when a new message arrives within the existing window", () => {
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("user-hash-abc");
    // Advance 23 hours and re-record (user sends another message)
    fakeNow += 23 * 60 * 60 * 1000;
    tracker.recordInbound("user-hash-abc");
    // Now advance another 23 hours — window should still be open
    fakeNow += 23 * 60 * 60 * 1000;
    expect(tracker.isWindowOpen("user-hash-abc")).toBe(true);
  });

  it("tracks windows independently for different users", () => {
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("user-A");
    fakeNow += 24 * 60 * 60 * 1000 + 1;
    // user-A window closed, user-B never recorded
    expect(tracker.isWindowOpen("user-A")).toBe(false);
    expect(tracker.isWindowOpen("user-B")).toBe(false);

    tracker.recordInbound("user-B");
    expect(tracker.isWindowOpen("user-B")).toBe(true);
    expect(tracker.isWindowOpen("user-A")).toBe(false);
  });

  it("cleanup removes expired windows without throwing", () => {
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("user-X");
    tracker.recordInbound("user-Y");
    // Advance past window for user-X only
    fakeNow += 24 * 60 * 60 * 1000 + 1;
    tracker.cleanup();
    expect(tracker.isWindowOpen("user-X")).toBe(false);
    // user-Y window was just recorded but also expired due to fakeNow advance
    expect(tracker.isWindowOpen("user-Y")).toBe(false);
  });

  it("cleanup preserves windows that have not expired", () => {
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("user-fresh");
    // Only advance 1 hour — window is still open
    fakeNow += 60 * 60 * 1000;
    tracker.cleanup();
    expect(tracker.isWindowOpen("user-fresh")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3b. outbound.ts — splitText
// ---------------------------------------------------------------------------

describe("splitText", () => {
  it("returns a single chunk when text is shorter than the limit", () => {
    expect(splitText("hello world", 4096)).toEqual(["hello world"]);
  });

  it("returns a single chunk when text is exactly at the limit", () => {
    const text = "a".repeat(4096);
    expect(splitText(text, 4096)).toEqual([text]);
  });

  it("splits text longer than 4096 chars into multiple chunks", () => {
    const text = "word ".repeat(1000); // ~5000 chars
    const chunks = splitText(text, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it("splits at a newline boundary when available", () => {
    const line1 = "a".repeat(20);
    const line2 = "b".repeat(20);
    const text = `${line1}\n${line2}`;
    const chunks = splitText(text, 25);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toBe(line2);
  });

  it("splits at a space boundary when no suitable newline exists", () => {
    const text = "a".repeat(20) + " " + "b".repeat(20);
    const chunks = splitText(text, 25);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(25);
    }
  });

  it("hard-breaks when no word boundary is available", () => {
    const text = "x".repeat(100);
    const chunks = splitText(text, 40);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(40);
    }
  });
});

// ---------------------------------------------------------------------------
// 3c. outbound.ts — sendOutbound
// ---------------------------------------------------------------------------

describe("sendOutbound — window open", () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateSpy = vi.spyOn(Date, "now").mockImplementation(() => 1_000_000_000);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it("sends a text message when the window is open", async () => {
    const { client, calls } = mockApiClient();
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("recipient-hash");

    await sendOutbound(client, "recipient-hash", { type: "text", text: "Hello!" }, tracker, VALID_CONFIG);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "recipient-hash",
      type: "text",
      text: { body: "Hello!" },
    });
  });

  it("sends multiple chunks when text exceeds 4096 chars", async () => {
    const { client, calls } = mockApiClient();
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("recipient-hash");

    const longText = "word ".repeat(1000); // ~5000 chars
    await sendOutbound(client, "recipient-hash", { type: "text", text: longText }, tracker, VALID_CONFIG);

    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.type).toBe("text");
      if (call.type === "text") {
        expect(call.text.body.length).toBeLessThanOrEqual(4096);
      }
    }
  });

  it("sends an image as type:image when mimeType starts with image/", async () => {
    const { client, calls } = mockApiClient();
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("recipient-hash");

    await sendOutbound(
      client,
      "recipient-hash",
      { type: "media", url: "https://example.com/photo.jpg", mimeType: "image/jpeg", caption: "A picture" },
      tracker,
      VALID_CONFIG,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe("image");
    if (calls[0]!.type === "image") {
      expect(calls[0]!.image.link).toBe("https://example.com/photo.jpg");
      expect(calls[0]!.image.caption).toBe("A picture");
    }
  });

  it("sends a non-image media as type:document", async () => {
    const { client, calls } = mockApiClient();
    const tracker = new ConversationWindowTracker();
    tracker.recordInbound("recipient-hash");

    await sendOutbound(
      client,
      "recipient-hash",
      { type: "media", url: "https://example.com/file.pdf", mimeType: "application/pdf" },
      tracker,
      VALID_CONFIG,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe("document");
    if (calls[0]!.type === "document") {
      expect(calls[0]!.document.link).toBe("https://example.com/file.pdf");
    }
  });
});

describe("sendOutbound — window closed, no template", () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateSpy = vi.spyOn(Date, "now").mockImplementation(() => 1_000_000_000);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it("throws when the window is closed and no fallback template is configured", async () => {
    const { client } = mockApiClient();
    const tracker = new ConversationWindowTracker();
    // Do not record inbound — window is closed

    await expect(
      sendOutbound(client, "unknown-hash", { type: "text", text: "hello" }, tracker, VALID_CONFIG),
    ).rejects.toThrow("24-hour messaging window closed");
  });
});

describe("sendOutbound — window closed, template fallback", () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateSpy = vi.spyOn(Date, "now").mockImplementation(() => 1_000_000_000);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it("sends a template message when window is closed and fallback template is set", async () => {
    const { client, calls } = mockApiClient();
    const tracker = new ConversationWindowTracker();
    const config: WhatsAppConfig = { ...VALID_CONFIG, fallbackTemplateName: "hello_world" };

    await sendOutbound(client, "recipient-hash", { type: "text", text: "Hi!" }, tracker, config);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe("template");
    if (calls[0]!.type === "template") {
      expect(calls[0]!.template.name).toBe("hello_world");
      expect(calls[0]!.template.language.code).toBe("en_US");
    }
  });

  it("uses the configured fallbackTemplateLanguage for the template", async () => {
    const { client, calls } = mockApiClient();
    const tracker = new ConversationWindowTracker();
    const config: WhatsAppConfig = {
      ...VALID_CONFIG,
      fallbackTemplateName: "greeting",
      fallbackTemplateLanguage: "pt_BR",
    };

    await sendOutbound(client, "recipient-hash", { type: "text", text: "Oi!" }, tracker, config);

    expect(calls[0]!.type).toBe("template");
    if (calls[0]!.type === "template") {
      expect(calls[0]!.template.language.code).toBe("pt_BR");
    }
  });

  it("includes body text as a template component parameter", async () => {
    const { client, calls } = mockApiClient();
    const tracker = new ConversationWindowTracker();
    const config: WhatsAppConfig = { ...VALID_CONFIG, fallbackTemplateName: "hello_world" };

    await sendOutbound(client, "recipient-hash", { type: "text", text: "Hello there!" }, tracker, config);

    expect(calls[0]!.type).toBe("template");
    if (calls[0]!.type === "template") {
      const components = calls[0]!.template.components ?? [];
      expect(components.length).toBe(1);
      expect(components[0]!.type).toBe("body");
      expect(components[0]!.parameters[0]!.text).toBe("Hello there!");
    }
  });

  it("sends empty components array when template body text is empty", async () => {
    const { client, calls } = mockApiClient();
    const tracker = new ConversationWindowTracker();
    const config: WhatsAppConfig = { ...VALID_CONFIG, fallbackTemplateName: "hello_world" };

    // media with no caption → empty bodyText
    await sendOutbound(
      client,
      "recipient-hash",
      { type: "media", url: "https://example.com/img.jpg", mimeType: "image/jpeg" },
      tracker,
      config,
    );

    expect(calls[0]!.type).toBe("template");
    if (calls[0]!.type === "template") {
      expect(calls[0]!.template.components).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. security.ts — verifyWebhookSignature
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature", () => {
  const secret = "test-app-secret";
  const body = '{"object":"whatsapp_business_account","entry":[]}';

  it("returns true for a valid HMAC-SHA256 signature", () => {
    const sig = signBody(body, secret);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("returns false for a tampered body", () => {
    const sig = signBody(body, secret);
    expect(verifyWebhookSignature(body + "tampered", sig, secret)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const sig = signBody(body, secret);
    expect(verifyWebhookSignature(body, sig, "wrong-secret")).toBe(false);
  });

  it("returns false when signature lacks the sha256= prefix", () => {
    const rawHex = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, rawHex, secret)).toBe(false);
  });

  it("returns false for an empty signature string", () => {
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
  });

  it("returns false for a malformed hex string after sha256=", () => {
    expect(verifyWebhookSignature(body, "sha256=not-valid-hex!!", secret)).toBe(false);
  });

  it("accepts a Buffer body and verifies correctly", () => {
    const bufBody = Buffer.from(body);
    const sig = "sha256=" + createHmac("sha256", secret).update(bufBody).digest("hex");
    expect(verifyWebhookSignature(bufBody, sig, secret)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4b. security.ts — hashPhoneForAllowlist
// ---------------------------------------------------------------------------

describe("hashPhoneForAllowlist", () => {
  it("returns a 64-character hex hash", () => {
    const hash = hashPhoneForAllowlist("+14155552671");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches hashPhoneNumber from normalizer for the same input", () => {
    const phone = "+14155552671";
    expect(hashPhoneForAllowlist(phone)).toBe(hashPhoneNumber(phone));
  });
});

// ---------------------------------------------------------------------------
// 4c. security.ts — createSecurityAdapter
// ---------------------------------------------------------------------------

describe("createSecurityAdapter — allowlist", () => {
  it("allows any user when no allowlist is configured", async () => {
    const sec = createSecurityAdapter({});
    expect(await sec.isAllowed("any-hash")).toBe(true);
  });

  it("allows any user when allowedPhoneHashes is empty", async () => {
    const sec = createSecurityAdapter({ allowedPhoneHashes: [] });
    expect(await sec.isAllowed("any-hash")).toBe(true);
  });

  it("allows a user whose hash is in the allowlist", async () => {
    const hash = hashPhoneNumber("+14155550100");
    const sec = createSecurityAdapter({ allowedPhoneHashes: [hash] });
    expect(await sec.isAllowed(hash)).toBe(true);
  });

  it("blocks a user whose hash is not in the allowlist", async () => {
    const hash = hashPhoneNumber("+14155550100");
    const otherHash = hashPhoneNumber("+12125550200");
    const sec = createSecurityAdapter({ allowedPhoneHashes: [hash] });
    expect(await sec.isAllowed(otherHash)).toBe(false);
  });

  it("getAllowlist returns the configured hashes", async () => {
    const h1 = hashPhoneNumber("+111");
    const h2 = hashPhoneNumber("+222");
    const sec = createSecurityAdapter({ allowedPhoneHashes: [h1, h2] });
    const list = await sec.getAllowlist();
    expect(list).toEqual(expect.arrayContaining([h1, h2]));
    expect(list).toHaveLength(2);
  });

  it("getAllowlist returns an empty array when no allowlist configured", async () => {
    const sec = createSecurityAdapter({});
    expect(await sec.getAllowlist()).toEqual([]);
  });
});

describe("createSecurityAdapter — rate limiting", () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;
  let fakeNow: number;

  beforeEach(() => {
    fakeNow = 1_000_000;
    dateSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it("allows the first N calls within the rate limit", async () => {
    const limit = 3;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });
    for (let i = 0; i < limit; i++) {
      expect(await sec.isAllowed("user-hash")).toBe(true);
    }
  });

  it("blocks the (N+1)th call in the same 60-second window", async () => {
    const limit = 3;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });
    for (let i = 0; i < limit; i++) {
      await sec.isAllowed("user-hash");
    }
    expect(await sec.isAllowed("user-hash")).toBe(false);
  });

  it("allows the user again after the 60-second window expires", async () => {
    const limit = 2;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });

    await sec.isAllowed("user-hash");
    await sec.isAllowed("user-hash");
    expect(await sec.isAllowed("user-hash")).toBe(false);

    fakeNow += 61_000;
    expect(await sec.isAllowed("user-hash")).toBe(true);
  });

  it("tracks rate limits independently per user", async () => {
    const limit = 1;
    const sec = createSecurityAdapter({ rateLimitPerMinute: limit });

    await sec.isAllowed("user-A");
    expect(await sec.isAllowed("user-A")).toBe(false);
    // user-B has its own independent bucket
    expect(await sec.isAllowed("user-B")).toBe(true);
  });

  it("uses default rate limit of 20 when not specified", async () => {
    const sec = createSecurityAdapter({});
    for (let i = 0; i < 20; i++) {
      expect(await sec.isAllowed("user-default")).toBe(true);
    }
    expect(await sec.isAllowed("user-default")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. webhook.ts — handleWebhook
// ---------------------------------------------------------------------------

describe("handleWebhook — path routing", () => {
  it("returns false for a path that does not end with /webhook/whatsapp", async () => {
    const req = mockRequest("GET", "/some/other/path", "");
    const res = mockResponse();
    const deps = {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    };
    const handled = await handleWebhook(req, res, deps);
    expect(handled).toBe(false);
  });

  it("returns false for root path", async () => {
    const req = mockRequest("GET", "/", "");
    const res = mockResponse();
    const deps = {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    };
    expect(await handleWebhook(req, res, deps)).toBe(false);
  });

  it("returns true for a path ending with /webhook/whatsapp", async () => {
    const url = "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=my-verify-token&hub.challenge=abc";
    const req = mockRequest("GET", url, "");
    const res = mockResponse();
    const deps = {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    };
    const handled = await handleWebhook(req, res, deps);
    expect(handled).toBe(true);
  });
});

describe("handleWebhook — GET verification challenge", () => {
  it("responds with 200 and the challenge string for a valid verification request", async () => {
    const url = "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=my-verify-token&hub.challenge=CHALLENGE123";
    const req = mockRequest("GET", url, "");
    const res = mockResponse();
    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("CHALLENGE123");
  });

  it("responds with 403 when hub.mode is not 'subscribe'", async () => {
    const url = "/webhook/whatsapp?hub.mode=unsubscribe&hub.verify_token=my-verify-token&hub.challenge=X";
    const req = mockRequest("GET", url, "");
    const res = mockResponse();
    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("responds with 403 when verify_token is incorrect", async () => {
    const url = "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=X";
    const req = mockRequest("GET", url, "");
    const res = mockResponse();
    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("responds with 403 when hub.challenge is missing", async () => {
    const url = "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=my-verify-token";
    const req = mockRequest("GET", url, "");
    const res = mockResponse();
    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("handleWebhook — POST inbound", () => {
  it("responds with 401 when X-Hub-Signature-256 header is missing", async () => {
    const body = JSON.stringify(textPayload("+1234567890", "hello").entry);
    const req = mockRequest("POST", "/webhook/whatsapp", body);
    const res = mockResponse();
    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("responds with 401 when signature is invalid", async () => {
    const payload = textPayload("+1234567890", "hello");
    const body = JSON.stringify(payload);
    const req = mockRequest("POST", "/webhook/whatsapp", body, {
      "x-hub-signature-256": "sha256=invalid000000000000000000000000000000000000000000000000000000",
    });
    const res = mockResponse();
    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("responds with 200 and calls onMessages for a valid signed POST", async () => {
    const payload = textPayload("+1234567890", "hello world");
    const body = JSON.stringify(payload);
    const sig = signBody(body, VALID_CONFIG.appSecret);

    const req = mockRequest("POST", "/webhook/whatsapp", body, {
      "x-hub-signature-256": sig,
    });
    const res = mockResponse();
    const onMessages = vi.fn().mockResolvedValue(undefined);

    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages,
    });

    expect(res.statusCode).toBe(200);
    expect(onMessages).toHaveBeenCalledTimes(1);
    const messages = onMessages.mock.calls[0]![0];
    expect(messages).toHaveLength(1);
    if (messages[0]!.content.type === "text") {
      expect(messages[0]!.content.text).toBe("hello world");
    }
  });

  it("records inbound in window tracker for each message", async () => {
    const phone = "+1234567890";
    const payload = textPayload(phone, "hello");
    const body = JSON.stringify(payload);
    const sig = signBody(body, VALID_CONFIG.appSecret);

    const req = mockRequest("POST", "/webhook/whatsapp", body, {
      "x-hub-signature-256": sig,
    });
    const res = mockResponse();
    const tracker = new ConversationWindowTracker();

    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: tracker,
      onMessages: vi.fn().mockResolvedValue(undefined),
    });

    const hash = hashPhoneNumber(phone);
    expect(tracker.isWindowOpen(hash)).toBe(true);
  });

  it("responds with 200 but ignores non-whatsapp_business_account object type", async () => {
    const payload = { object: "page", entry: [] };
    const body = JSON.stringify(payload);
    const sig = signBody(body, VALID_CONFIG.appSecret);

    const req = mockRequest("POST", "/webhook/whatsapp", body, {
      "x-hub-signature-256": sig,
    });
    const res = mockResponse();
    const onMessages = vi.fn();

    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages,
    });

    expect(res.statusCode).toBe(200);
    expect(onMessages).not.toHaveBeenCalled();
  });

  it("responds with 200 even if JSON body is malformed (graceful error handling)", async () => {
    const body = "this is not json {{{";
    const sig = signBody(body, VALID_CONFIG.appSecret);

    const req = mockRequest("POST", "/webhook/whatsapp", body, {
      "x-hub-signature-256": sig,
    });
    const res = mockResponse();

    await expect(
      handleWebhook(req, res, {
        config: VALID_CONFIG,
        windowTracker: new ConversationWindowTracker(),
        onMessages: vi.fn(),
      }),
    ).resolves.toBe(true);

    expect(res.statusCode).toBe(200);
  });

  it("responds with 405 for unsupported HTTP methods", async () => {
    const req = mockRequest("DELETE", "/webhook/whatsapp", "");
    const res = mockResponse();
    await handleWebhook(req, res, {
      config: VALID_CONFIG,
      windowTracker: new ConversationWindowTracker(),
      onMessages: vi.fn(),
    });
    expect(res.statusCode).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// 6. index.ts — createWhatsAppPlugin
// ---------------------------------------------------------------------------

describe("createWhatsAppPlugin", () => {
  it("throws when accessToken is empty", () => {
    expect(() =>
      createWhatsAppPlugin({ ...VALID_CONFIG, accessToken: "" }),
    ).toThrow("Invalid WhatsApp config");
  });

  it("throws when phoneNumberId is missing", () => {
    expect(() =>
      createWhatsAppPlugin({ ...VALID_CONFIG, phoneNumberId: "" }),
    ).toThrow();
  });

  it("throws when appSecret is empty", () => {
    expect(() =>
      createWhatsAppPlugin({ ...VALID_CONFIG, appSecret: "" }),
    ).toThrow();
  });

  it('returns a plugin with id "whatsapp"', () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(plugin.id).toBe("whatsapp");
  });

  it('has meta.name "WhatsApp"', () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(plugin.meta.name).toBe("WhatsApp");
  });

  it('has meta.version "0.1.0"', () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(plugin.meta.version).toBe("0.1.0");
  });

  it("has meta.description as a non-empty string", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(typeof plugin.meta.description).toBe("string");
    expect((plugin.meta.description ?? "").length).toBeGreaterThan(0);
  });

  it("has correct capabilities", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(plugin.capabilities).toEqual({
      text: true,
      media: true,
      voice: true,
      reactions: false,
      threads: false,
      ephemeral: false,
    });
  });

  it("config.validate() accepts a valid config", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(plugin.config.validate(VALID_CONFIG)).toBe(true);
  });

  it("config.validate() rejects an invalid config", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(plugin.config.validate({})).toBe(false);
  });

  it("config.getDefaults() returns expected defaults", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    const defaults = plugin.config.getDefaults();
    expect(defaults).toMatchObject({
      apiBaseUrl: "https://graph.facebook.com",
      apiVersion: "v21.0",
      rateLimitPerMinute: 20,
    });
  });

  it("gateway.isRunning() returns false before start is called", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(plugin.gateway.isRunning()).toBe(false);
  });

  it("gateway.isRunning() returns true after start is called", async () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    await plugin.gateway.start();
    expect(plugin.gateway.isRunning()).toBe(true);
    await plugin.gateway.stop();
  });

  it("gateway.isRunning() returns false after stop is called", async () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    await plugin.gateway.start();
    await plugin.gateway.stop();
    expect(plugin.gateway.isRunning()).toBe(false);
  });

  it("messaging.onMessage registers a handler without throwing", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(() => {
      plugin.messaging.onMessage(async () => {
        // no-op
      });
    }).not.toThrow();
  });

  it("has a security adapter with isAllowed and getAllowlist", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(plugin.security).toBeDefined();
    expect(typeof plugin.security!.isAllowed).toBe("function");
    expect(typeof plugin.security!.getAllowlist).toBe("function");
  });

  it("security.isAllowed returns true in open mode (no allowlist)", async () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(await plugin.security!.isAllowed("any-user-hash")).toBe(true);
  });

  it("has outbound.send as a function", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(typeof plugin.outbound.send).toBe("function");
  });

  it("has gateway.start and gateway.stop as functions", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(typeof plugin.gateway.start).toBe("function");
    expect(typeof plugin.gateway.stop).toBe("function");
  });

  it("exposes a webhookHandler function", () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    expect(typeof plugin.webhookHandler).toBe("function");
  });

  it("webhookHandler returns false for non-whatsapp paths", async () => {
    const plugin = createWhatsAppPlugin(VALID_CONFIG);
    const req = mockRequest("GET", "/other", "");
    const res = mockResponse();
    const result = await plugin.webhookHandler(req, res);
    expect(result).toBe(false);
  });

});
