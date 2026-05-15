import { describe, it, expect } from "vitest";
import type { ChannelContext } from "@agi/sdk";
import {
  encodeRoomId,
  decodeRoomId,
  signalMessageToChannelMessage,
  signalMessageToRoom,
  createSignalChannelDefV2,
  SIGNAL_CHANNEL_ID_V2,
} from "./channel-def.js";
import type { SignalMessage } from "./signal-cli-client.js";

const noop = () => {};
const STUB_CTX: ChannelContext = {
  config: {},
  logger: { info: noop, warn: noop, error: noop },
  cageProvider: () => null,
  resolveEntity: async () => ({ entityId: "pending-stub", isPending: true }),
};

const PHONE = "+14155552671";
const GROUP_ID = "group-abc123";

// ---------------------------------------------------------------------------
// roomId encode / decode
// ---------------------------------------------------------------------------

describe("encodeRoomId", () => {
  it("encodes a DM", () => {
    expect(encodeRoomId("dm", "abc")).toBe("signal:dm:abc");
  });

  it("encodes a group", () => {
    expect(encodeRoomId("group", GROUP_ID)).toBe(`signal:group:${GROUP_ID}`);
  });
});

describe("decodeRoomId", () => {
  it("decodes a DM roomId", () => {
    expect(decodeRoomId("signal:dm:abc")).toEqual({ kind: "dm", id: "abc" });
  });

  it("decodes a group roomId", () => {
    expect(decodeRoomId(`signal:group:${GROUP_ID}`)).toEqual({
      kind: "group",
      id: GROUP_ID,
    });
  });

  it("returns null for missing signal: prefix", () => {
    expect(decodeRoomId("wa:dm:abc")).toBeNull();
  });

  it("returns null for unknown conv type", () => {
    expect(decodeRoomId("signal:voice:abc")).toBeNull();
  });

  it("returns null when id is empty", () => {
    expect(decodeRoomId("signal:dm:")).toBeNull();
  });

  it("returns null when no colon after type", () => {
    expect(decodeRoomId("signal:dm")).toBeNull();
  });

  it("roundtrips DM encode → decode", () => {
    const roomId = encodeRoomId("dm", "deadbeef");
    expect(decodeRoomId(roomId)).toEqual({ kind: "dm", id: "deadbeef" });
  });

  it("roundtrips group encode → decode", () => {
    const roomId = encodeRoomId("group", GROUP_ID);
    expect(decodeRoomId(roomId)).toEqual({ kind: "group", id: GROUP_ID });
  });
});

// ---------------------------------------------------------------------------
// signalMessageToChannelMessage
// ---------------------------------------------------------------------------

function makeMsg(overrides: Partial<SignalMessage["envelope"]> = {}): SignalMessage {
  return {
    envelope: {
      source: PHONE,
      sourceDevice: 1,
      timestamp: 1715000000000,
      dataMessage: {
        message: "hello signal",
      },
      ...overrides,
    },
  };
}

describe("signalMessageToChannelMessage", () => {
  it("normalizes a basic DM text message", () => {
    const result = signalMessageToChannelMessage(makeMsg());
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe("1715000000000");
    expect(result!.text).toBe("hello signal");
    expect(result!.authorId).toHaveLength(64); // SHA-256 hex
    expect(result!.roomId).toMatch(/^signal:dm:[0-9a-f]{64}$/);
  });

  it("returns null when envelope has no dataMessage", () => {
    const msg: SignalMessage = {
      envelope: { source: PHONE, sourceDevice: 1, timestamp: 1715000000000 },
    };
    expect(signalMessageToChannelMessage(msg)).toBeNull();
  });

  it("marks DM messages as mentionsBot", () => {
    const result = signalMessageToChannelMessage(makeMsg());
    expect(result!.mentionsBot).toBe(true);
  });

  it("marks group messages as NOT mentionsBot", () => {
    const result = signalMessageToChannelMessage(
      makeMsg({ dataMessage: { message: "hi group", groupInfo: { groupId: GROUP_ID, type: "DELIVER" } } }),
    );
    expect(result!.mentionsBot).toBe(false);
  });

  it("encodes group roomId correctly", () => {
    const result = signalMessageToChannelMessage(
      makeMsg({ dataMessage: { message: "hi", groupInfo: { groupId: GROUP_ID, type: "DELIVER" } } }),
    );
    expect(result!.roomId).toBe(`signal:group:${GROUP_ID}`);
  });

  it("parses sentAt from epoch ms timestamp", () => {
    const result = signalMessageToChannelMessage(makeMsg());
    expect(result!.sentAt).toBe(new Date(1715000000000).toISOString());
  });

  it("surfaces audio attachment with kind 'audio'", () => {
    const result = signalMessageToChannelMessage(
      makeMsg({
        dataMessage: {
          message: "",
          attachments: [{ contentType: "audio/ogg", id: "att001", size: 12345 }],
        },
      }),
    );
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0]!.kind).toBe("audio");
    expect(result!.attachments![0]!.url).toBe("att001");
  });

  it("surfaces non-audio attachment with kind 'file'", () => {
    const result = signalMessageToChannelMessage(
      makeMsg({
        dataMessage: {
          message: "",
          attachments: [{ contentType: "application/pdf", id: "att002", size: 9000 }],
        },
      }),
    );
    expect(result!.attachments![0]!.kind).toBe("file");
  });

  it("captures reply quote as replyToMessageId", () => {
    const result = signalMessageToChannelMessage(
      makeMsg({
        dataMessage: {
          message: "replying",
          quote: { id: 9876543, author: PHONE, text: "original" },
        },
      }),
    );
    expect(result!.replyToMessageId).toBe("9876543");
  });

  it("two messages from same phone produce the same roomId", () => {
    const r1 = signalMessageToChannelMessage(makeMsg({ timestamp: 1000 }));
    const r2 = signalMessageToChannelMessage(makeMsg({ timestamp: 2000 }));
    expect(r1!.roomId).toBe(r2!.roomId);
  });

  it("two messages from different phones produce different roomIds", () => {
    const r1 = signalMessageToChannelMessage(makeMsg({ source: "+14155551111" }));
    const r2 = signalMessageToChannelMessage(makeMsg({ source: "+14155552222" }));
    expect(r1!.roomId).not.toBe(r2!.roomId);
  });
});

// ---------------------------------------------------------------------------
// signalMessageToRoom
// ---------------------------------------------------------------------------

describe("signalMessageToRoom", () => {
  it("returns a DM room for a 1-1 message", () => {
    const room = signalMessageToRoom(makeMsg());
    expect(room.kind).toBe("dm");
    expect(room.privacy).toBe("private");
    expect(room.roomId).toMatch(/^signal:dm:[0-9a-f]{64}$/);
  });

  it("returns a group room for a group message", () => {
    const room = signalMessageToRoom(
      makeMsg({ dataMessage: { groupInfo: { groupId: GROUP_ID, type: "DELIVER" } } }),
    );
    expect(room.kind).toBe("group");
    expect(room.roomId).toBe(`signal:group:${GROUP_ID}`);
  });
});

// ---------------------------------------------------------------------------
// createSignalChannelDefV2 — shape validation
// ---------------------------------------------------------------------------

const STUB_CONFIG = {
  signalCliUrl: "http://localhost:8080",
  accountNumber: "+14155552671",
};

describe("createSignalChannelDefV2", () => {
  it("returns a ChannelDefinition with the correct id", () => {
    const def = createSignalChannelDefV2(STUB_CONFIG);
    expect(def.id).toBe(SIGNAL_CHANNEL_ID_V2);
    expect(def.id).toBe("signal");
  });

  it("displayName is Signal", () => {
    const def = createSignalChannelDefV2(STUB_CONFIG);
    expect(def.displayName).toBe("Signal");
  });

  it("exposes a createProtocol factory", () => {
    const def = createSignalChannelDefV2(STUB_CONFIG);
    expect(typeof def.createProtocol).toBe("function");
  });

  it("protocol has all required ChannelProtocol methods", () => {
    const def = createSignalChannelDefV2(STUB_CONFIG);
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
    const def = createSignalChannelDefV2(STUB_CONFIG);
    const proto = def.createProtocol(STUB_CTX);
    expect(typeof proto.onEvent(() => {})).toBe("function");
  });

  it("subscribeRoom returns an unsubscribe function", () => {
    const def = createSignalChannelDefV2(STUB_CONFIG);
    const proto = def.createProtocol(STUB_CTX);
    expect(typeof proto.subscribeRoom(encodeRoomId("dm", "a".repeat(64)), () => {})).toBe("function");
  });

  it("readPolicy has empty nativeIntents (no OAuth scopes for Signal)", () => {
    const def = createSignalChannelDefV2(STUB_CONFIG);
    expect(def.readPolicy.nativeIntents).toEqual([]);
  });

  it("throws on invalid config", () => {
    expect(() => createSignalChannelDefV2({} as never)).toThrow();
  });
});
