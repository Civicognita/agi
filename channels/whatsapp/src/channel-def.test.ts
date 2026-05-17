import { describe, it, expect } from "vitest";
import type { ChannelContext } from "@agi/sdk";
import {
  encodeRoomId,
  decodePhoneHash,
  waMessageToChannelMessage,
  waPayloadToChannelMessages,
  createWhatsAppChannelDefV2,
  WHATSAPP_CHANNEL_ID_V2,
  type WhatsAppChannelProtocol,
} from "./channel-def.js";
import type { WhatsAppMessage, WhatsAppWebhookPayload } from "./types.js";

const noop = () => {};
const STUB_CTX: ChannelContext = {
  config: {},
  logger: { info: noop, warn: noop, error: noop },
  cageProvider: () => null,
  resolveEntity: async () => ({ entityId: "pending-stub", isPending: true }),
};

// SHA-256 of "+14155552671" — pre-computed for test assertions
const PHONE = "+14155552671";
// We won't hard-code the hash value; we'll use the same function under test.

// ---------------------------------------------------------------------------
// roomId encode / decode
// ---------------------------------------------------------------------------

describe("encodeRoomId", () => {
  it("produces wa:dm:<64-char-hash> format", () => {
    const hash = "a".repeat(64);
    expect(encodeRoomId(hash)).toBe(`wa:dm:${hash}`);
  });
});

describe("decodePhoneHash", () => {
  it("decodes a valid wa:dm: roomId", () => {
    const hash = "b".repeat(64);
    expect(decodePhoneHash(`wa:dm:${hash}`)).toBe(hash);
  });

  it("returns null for missing wa:dm: prefix", () => {
    expect(decodePhoneHash("discord:1234:channel:5678")).toBeNull();
  });

  it("returns null when hash is not 64 chars", () => {
    expect(decodePhoneHash("wa:dm:tooshort")).toBeNull();
  });

  it("roundtrips encode → decode", () => {
    const hash = "c".repeat(64);
    expect(decodePhoneHash(encodeRoomId(hash))).toBe(hash);
  });
});

// ---------------------------------------------------------------------------
// waMessageToChannelMessage
// ---------------------------------------------------------------------------

const NO_CONTACTS = new Map<string, string>();
const STUB_CONFIG = { apiBaseUrl: "https://graph.facebook.com", apiVersion: "v21.0" };

function makeTextMsg(overrides: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
  return {
    type: "text",
    from: PHONE,
    id: "wamid.test001",
    timestamp: "1715000000",
    text: { body: "hello world" },
    ...overrides,
  } as WhatsAppMessage;
}

describe("waMessageToChannelMessage", () => {
  it("normalizes a basic text message", () => {
    const result = waMessageToChannelMessage(makeTextMsg(), NO_CONTACTS, STUB_CONFIG);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe("wamid.test001");
    expect(result!.text).toBe("hello world");
    expect(result!.authorId).toHaveLength(64); // SHA-256 hex
    expect(result!.roomId).toMatch(/^wa:dm:[0-9a-f]{64}$/);
  });

  it("marks all messages as mentionsBot (1-1 Business API)", () => {
    const result = waMessageToChannelMessage(makeTextMsg(), NO_CONTACTS, STUB_CONFIG);
    expect(result!.mentionsBot).toBe(true);
  });

  it("parses sentAt from WhatsApp unix timestamp string", () => {
    const result = waMessageToChannelMessage(makeTextMsg({ timestamp: "1715000000" }), NO_CONTACTS, STUB_CONFIG);
    expect(result!.sentAt).toBe(new Date(1715000000 * 1000).toISOString());
  });

  it("surfaces image as attachment with kind 'image'", () => {
    const msg: WhatsAppMessage = {
      type: "image",
      from: PHONE,
      id: "wamid.img001",
      timestamp: "1715000000",
      image: { id: "media123", mime_type: "image/jpeg", sha256: "abc", caption: "a photo" },
    };
    const result = waMessageToChannelMessage(msg, NO_CONTACTS, STUB_CONFIG);
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0]!.kind).toBe("image");
    expect(result!.attachments![0]!.mime).toBe("image/jpeg");
    expect(result!.text).toBe("a photo");
  });

  it("surfaces audio as attachment with kind 'audio'", () => {
    const msg: WhatsAppMessage = {
      type: "audio",
      from: PHONE,
      id: "wamid.audio001",
      timestamp: "1715000000",
      audio: { id: "media456", mime_type: "audio/ogg" },
    };
    const result = waMessageToChannelMessage(msg, NO_CONTACTS, STUB_CONFIG);
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0]!.kind).toBe("audio");
  });

  it("surfaces document as attachment with kind 'file'", () => {
    const msg: WhatsAppMessage = {
      type: "document",
      from: PHONE,
      id: "wamid.doc001",
      timestamp: "1715000000",
      document: { id: "media789", mime_type: "application/pdf", sha256: "def", caption: "report" },
    };
    const result = waMessageToChannelMessage(msg, NO_CONTACTS, STUB_CONFIG);
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0]!.kind).toBe("file");
    expect(result!.text).toBe("report");
  });

  it("returns null for reaction message", () => {
    const msg: WhatsAppMessage = {
      type: "reaction",
      from: PHONE,
      id: "wamid.react001",
      timestamp: "1715000000",
      reaction: { message_id: "wamid.test001", emoji: "👍" },
    };
    expect(waMessageToChannelMessage(msg, NO_CONTACTS, STUB_CONFIG)).toBeNull();
  });

  it("captures reply context as replyToMessageId", () => {
    const result = waMessageToChannelMessage(
      makeTextMsg({ context: { message_id: "wamid.original001" } }),
      NO_CONTACTS,
      STUB_CONFIG,
    );
    expect(result!.replyToMessageId).toBe("wamid.original001");
  });

  it("two messages from same phone produce the same roomId", () => {
    const msg1 = waMessageToChannelMessage(makeTextMsg({ id: "wamid.1" }), NO_CONTACTS, STUB_CONFIG);
    const msg2 = waMessageToChannelMessage(makeTextMsg({ id: "wamid.2" }), NO_CONTACTS, STUB_CONFIG);
    expect(msg1!.roomId).toBe(msg2!.roomId);
  });

  it("two messages from different phones produce different roomIds", () => {
    const msg1 = waMessageToChannelMessage(makeTextMsg({ from: "+14155551111" }), NO_CONTACTS, STUB_CONFIG);
    const msg2 = waMessageToChannelMessage(makeTextMsg({ from: "+14155552222" }), NO_CONTACTS, STUB_CONFIG);
    expect(msg1!.roomId).not.toBe(msg2!.roomId);
  });
});

// ---------------------------------------------------------------------------
// waPayloadToChannelMessages
// ---------------------------------------------------------------------------

function makePayload(messages: WhatsAppMessage[]): WhatsAppWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABAID001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001234", phone_number_id: "PHONE_NUMBER_ID" },
              messages,
            },
          },
        ],
      },
    ],
  };
}

describe("waPayloadToChannelMessages", () => {
  it("extracts messages from a webhook payload", () => {
    const results = waPayloadToChannelMessages(makePayload([makeTextMsg()]), STUB_CONFIG);
    expect(results).toHaveLength(1);
    expect(results[0]!.msg.text).toBe("hello world");
    expect(results[0]!.rawPhone).toBe(PHONE);
  });

  it("returns empty for payloads with no messages field", () => {
    const payload: WhatsAppWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "E1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "1", phone_number_id: "X" } } }] }],
    };
    expect(waPayloadToChannelMessages(payload, STUB_CONFIG)).toHaveLength(0);
  });

  it("skips reaction messages", () => {
    const msg: WhatsAppMessage = {
      type: "reaction", from: PHONE, id: "r1", timestamp: "1715000000",
      reaction: { message_id: "wamid.x", emoji: "👍" },
    };
    expect(waPayloadToChannelMessages(makePayload([msg]), STUB_CONFIG)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createWhatsAppChannelDefV2 — shape validation
// ---------------------------------------------------------------------------

const STUB_CONFIG_FULL = {
  accessToken: "EAAtest123",
  phoneNumberId: "1234567890",
  verifyToken: "test-verify-token",
  appSecret: "test-app-secret",
};

describe("createWhatsAppChannelDefV2", () => {
  it("returns a ChannelDefinition with the correct id", () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    expect(def.id).toBe(WHATSAPP_CHANNEL_ID_V2);
    expect(def.id).toBe("whatsapp");
  });

  it("displayName is WhatsApp", () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    expect(def.displayName).toBe("WhatsApp");
  });

  it("exposes a createProtocol factory", () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    expect(typeof def.createProtocol).toBe("function");
  });

  it("protocol has all required ChannelProtocol methods", () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    const proto = def.createProtocol(STUB_CTX);
    expect(typeof proto.start).toBe("function");
    expect(typeof proto.onEvent).toBe("function");
    expect(typeof proto.listRooms).toBe("function");
    expect(typeof proto.getRoom).toBe("function");
    expect(typeof proto.subscribeRoom).toBe("function");
    expect(typeof proto.postToRoom).toBe("function");
    expect(typeof proto.searchMessages).toBe("function");
    expect(typeof proto.getUser).toBe("function");
    expect(typeof proto.listMembers).toBe("function");
  });

  it("protocol has processWebhook extra method", () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    const proto = def.createProtocol(STUB_CTX) as WhatsAppChannelProtocol;
    expect(typeof proto.processWebhook).toBe("function");
  });

  it("onEvent returns an unsubscribe function", () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    const proto = def.createProtocol(STUB_CTX);
    expect(typeof proto.onEvent(() => {})).toBe("function");
  });

  it("subscribeRoom returns an unsubscribe function", () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    const proto = def.createProtocol(STUB_CTX);
    expect(typeof proto.subscribeRoom(encodeRoomId("a".repeat(64)), () => {})).toBe("function");
  });

  it("processWebhook fires onEvent for each message", async () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    const proto = def.createProtocol(STUB_CTX) as WhatsAppChannelProtocol;
    const events: unknown[] = [];
    proto.onEvent((e) => events.push(e));

    await proto.processWebhook(makePayload([makeTextMsg()]));
    expect(events).toHaveLength(1);
    expect((events[0] as { kind: string }).kind).toBe("message");
  });

  it("listRooms returns rooms seen via processWebhook", async () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    const proto = def.createProtocol(STUB_CTX) as WhatsAppChannelProtocol;
    await proto.processWebhook(makePayload([makeTextMsg()]));
    const rooms = await proto.listRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.kind).toBe("dm");
    expect(rooms[0]!.privacy).toBe("private");
  });

  it("readPolicy includes whatsapp_business_messaging", () => {
    const def = createWhatsAppChannelDefV2(STUB_CONFIG_FULL);
    expect(def.readPolicy.nativeIntents).toContain("whatsapp_business_messaging");
  });

  it("throws on invalid config", () => {
    expect(() => createWhatsAppChannelDefV2({} as never)).toThrow();
  });
});
