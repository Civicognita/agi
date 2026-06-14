import { describe, it, expect } from "vitest";
import type { ChannelContext } from "@agi/sdk";
import {
  encodeRoomId,
  decodeRoomId,
  msgToChannelMessage,
  convToChannelRoom,
  createSlackChannelDefV2,
  SLACK_CHANNEL_ID,
  type SlackMessageEvent,
  type SlackConversation,
} from "./channel-def.js";

const noop = () => {};
const STUB_CTX: ChannelContext = {
  config: {},
  logger: { info: noop, warn: noop, error: noop },
  cageProvider: () => null,
  resolveEntity: async () => ({ entityId: "pending-stub", isPending: true }),
};

// ---------------------------------------------------------------------------
// roomId encode / decode
// ---------------------------------------------------------------------------

describe("encodeRoomId", () => {
  it("encodes a public channel", () => {
    expect(encodeRoomId("T0A1", "channel", "C0B2")).toBe("T0A1:channel:C0B2");
  });

  it("encodes a DM", () => {
    expect(encodeRoomId("T0A1", "dm", "U0C3")).toBe("T0A1:dm:U0C3");
  });

  it("encodes a group DM", () => {
    expect(encodeRoomId("T0A1", "mpdm", "G0D4")).toBe("T0A1:mpdm:G0D4");
  });
});

describe("decodeRoomId", () => {
  it("decodes a channel roomId", () => {
    expect(decodeRoomId("T0A1:channel:C0B2")).toEqual({
      teamId: "T0A1",
      convType: "channel",
      convId: "C0B2",
    });
  });

  it("decodes a DM roomId", () => {
    expect(decodeRoomId("T0A1:dm:U0C3")).toEqual({
      teamId: "T0A1",
      convType: "dm",
      convId: "U0C3",
    });
  });

  it("decodes a group DM roomId", () => {
    expect(decodeRoomId("T0A1:mpdm:G0D4")).toEqual({
      teamId: "T0A1",
      convType: "mpdm",
      convId: "G0D4",
    });
  });

  it("returns null for malformed roomId (no colons)", () => {
    expect(decodeRoomId("T0A1C0B2")).toBeNull();
  });

  it("returns null for unknown convType", () => {
    expect(decodeRoomId("T0A1:voice:C0B2")).toBeNull();
  });

  it("roundtrips channel", () => {
    const encoded = encodeRoomId("TWORKSPACE", "channel", "CCHANNEL");
    const decoded = decodeRoomId(encoded);
    expect(decoded).toEqual({ teamId: "TWORKSPACE", convType: "channel", convId: "CCHANNEL" });
  });
});

// ---------------------------------------------------------------------------
// msgToChannelMessage
// ---------------------------------------------------------------------------

const TEAM = "T0TEAM";
const BOT = "U0BOT";

function makeMsg(overrides: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
  return {
    type: "message",
    ts: "1715000000.000001",
    user: "U0USER",
    text: "hello world",
    channel: "C0CHAN",
    channel_type: "channel",
    ...overrides,
  };
}

describe("msgToChannelMessage", () => {
  it("normalizes a basic channel message", () => {
    const result = msgToChannelMessage(makeMsg(), TEAM, BOT);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe("1715000000.000001");
    expect(result!.roomId).toBe("T0TEAM:channel:C0CHAN");
    expect(result!.authorId).toBe("U0USER");
    expect(result!.text).toBe("hello world");
    expect(result!.mentionsBot).toBe(false);
  });

  it("detects @-mention of bot in channel message", () => {
    const result = msgToChannelMessage(makeMsg({ text: `hey <@${BOT}> help` }), TEAM, BOT);
    expect(result!.mentionsBot).toBe(true);
  });

  it("marks DM messages as mentionsBot", () => {
    const result = msgToChannelMessage(makeMsg({ channel_type: "im" }), TEAM, BOT);
    expect(result!.mentionsBot).toBe(true);
  });

  it("encodes DM roomId correctly", () => {
    const result = msgToChannelMessage(makeMsg({ channel: "D0DM", channel_type: "im" }), TEAM, BOT);
    expect(result!.roomId).toBe("T0TEAM:dm:D0DM");
  });

  it("encodes group DM roomId correctly", () => {
    const result = msgToChannelMessage(makeMsg({ channel: "G0GRP", channel_type: "mpim" }), TEAM, BOT);
    expect(result!.roomId).toBe("T0TEAM:mpdm:G0GRP");
  });

  it("returns null for message_changed subtype", () => {
    expect(msgToChannelMessage(makeMsg({ subtype: "message_changed" }), TEAM, BOT)).toBeNull();
  });

  it("returns null for bot_message subtype", () => {
    expect(msgToChannelMessage(makeMsg({ subtype: "bot_message" }), TEAM, BOT)).toBeNull();
  });

  it("returns null when user is missing (system message)", () => {
    const msg = makeMsg();
    delete (msg as Partial<SlackMessageEvent>).user;
    expect(msgToChannelMessage(msg as SlackMessageEvent, TEAM, BOT)).toBeNull();
  });

  it("surfaces file attachments as ChannelMessageAttachment[]", () => {
    const result = msgToChannelMessage(
      makeMsg({
        files: [
          { url_private: "https://files.slack.com/img.png", mimetype: "image/png" },
          { url_private: "https://files.slack.com/doc.pdf", mimetype: "application/pdf" },
        ],
      }),
      TEAM,
      BOT,
    );
    expect(result!.attachments).toHaveLength(2);
    const atts = result!.attachments ?? [];
    expect(atts[0]?.kind).toBe("image");
    expect(atts[1]?.kind).toBe("file");
  });

  it("parses sentAt from Slack unix-decimal timestamp", () => {
    const result = msgToChannelMessage(makeMsg({ ts: "1715000000.000001" }), TEAM, BOT);
    expect(result!.sentAt).toBe(new Date(1715000000000.001).toISOString());
  });
});

// ---------------------------------------------------------------------------
// convToChannelRoom
// ---------------------------------------------------------------------------

function makeConv(overrides: Partial<SlackConversation> = {}): SlackConversation {
  return { id: "C0CHAN", name: "general", is_channel: true, ...overrides };
}

describe("convToChannelRoom", () => {
  it("maps a public channel", () => {
    const room = convToChannelRoom(makeConv(), TEAM);
    expect(room.kind).toBe("channel");
    expect(room.privacy).toBe("public");
    expect(room.label).toBe("general");
    expect(room.roomId).toBe("T0TEAM:channel:C0CHAN");
  });

  it("maps a private channel", () => {
    const room = convToChannelRoom(makeConv({ is_private: true }), TEAM);
    expect(room.privacy).toBe("private");
  });

  it("maps a DM", () => {
    const room = convToChannelRoom(makeConv({ id: "D0DM", is_im: true, user: "U0USER" }), TEAM);
    expect(room.kind).toBe("dm");
    expect(room.roomId).toBe("T0TEAM:dm:D0DM");
    expect(room.label).toBe("U0USER");
  });

  it("maps a group DM", () => {
    const room = convToChannelRoom(makeConv({ id: "G0GRP", name: "mpdm-a--b--1", is_mpim: true }), TEAM);
    expect(room.kind).toBe("group");
    expect(room.roomId).toBe("T0TEAM:mpdm:G0GRP");
  });
});

// ---------------------------------------------------------------------------
// createSlackChannelDefV2 — shape validation
// ---------------------------------------------------------------------------

const STUB_CONFIG = {
  botToken: "xoxb-test-token",
  appToken: "xapp-test-token",
};

describe("createSlackChannelDefV2", () => {
  it("returns a ChannelDefinition with the correct id", () => {
    const def = createSlackChannelDefV2(STUB_CONFIG);
    expect(def.id).toBe(SLACK_CHANNEL_ID);
    expect(def.id).toBe("slack");
  });

  it("exposes a createProtocol factory", () => {
    const def = createSlackChannelDefV2(STUB_CONFIG);
    expect(typeof def.createProtocol).toBe("function");
  });

  it("protocol has all required methods", () => {
    const def = createSlackChannelDefV2(STUB_CONFIG);
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

  it("onEvent returns an unsubscribe function", () => {
    const def = createSlackChannelDefV2(STUB_CONFIG);
    const proto = def.createProtocol(STUB_CTX);
    const unsubscribe = proto.onEvent(() => {});
    expect(typeof unsubscribe).toBe("function");
  });

  it("subscribeRoom returns an unsubscribe function", () => {
    const def = createSlackChannelDefV2(STUB_CONFIG);
    const proto = def.createProtocol(STUB_CTX);
    const unsubscribe = proto.subscribeRoom("T0A1:channel:C0B2", () => {});
    expect(typeof unsubscribe).toBe("function");
  });

  it("has readPolicy with nativeIntents listing Slack OAuth scopes", () => {
    const def = createSlackChannelDefV2(STUB_CONFIG);
    expect(def.readPolicy.nativeIntents).toContain("channels:read");
    expect(def.readPolicy.nativeIntents).toContain("chat:write");
  });

  it("displayName is Slack", () => {
    const def = createSlackChannelDefV2(STUB_CONFIG);
    expect(def.displayName).toBe("Slack");
  });
});
