/**
 * defineChannelV2 + ChannelDefinition contract tests.
 */
import { describe, it, expect } from "vitest";
import { defineChannelV2 } from "./define-channel-v2.js";
import type {
  ChannelDefinition,
  ChannelProtocol,
  ChannelRoom,
  ChannelMessage,
  ChannelEvent,
} from "./channel-v2-types.js";

// Minimal stub protocol used by every test below.
function stubProtocol(): ChannelProtocol {
  return {
    start: async () => ({ stop: async () => undefined }),
    onEvent: () => () => undefined,
    listRooms: async () => [],
    getRoom: async () => null,
    subscribeRoom: () => () => undefined,
    postToRoom: async (roomId) =>
      ({
        messageId: "m1",
        roomId,
        authorId: "u1",
        text: "",
        sentAt: new Date(0).toISOString(),
        mentionsBot: false,
      }) satisfies ChannelMessage,
    searchMessages: async () => ({ messages: [] }),
    getUser: async () => null,
    listMembers: async () => [],
  };
}

// Stub React-ish component — typed as a function returning null. The
// SDK doesn't import React; ComponentType<P> = ((props: P) => ReactNode)
// in practice, so a plain function satisfies the type at the SDK layer.
const StubSettings = () => null;

function minimalDef(overrides: Partial<ChannelDefinition> = {}): ChannelDefinition {
  return {
    id: "test",
    displayName: "Test Channel",
    createProtocol: () => stubProtocol(),
    SettingsPage: StubSettings as unknown as ChannelDefinition["SettingsPage"],
    bridgeTools: [],
    readPolicy: {
      canReadAllMessages: { configurable: true, defaultOn: false },
      canReadPresence: { configurable: true, defaultOn: false },
      canReadRoles: { configurable: true, defaultOn: true },
    },
    ...overrides,
  };
}

describe("defineChannelV2 — happy path", () => {
  it("returns the input def unchanged when valid", () => {
    const def = minimalDef();
    const out = defineChannelV2(def);
    expect(out).toBe(def); // referential identity — no wrapping
  });

  it("compiles against ChannelDefinition with all optional fields populated", () => {
    const def = minimalDef({
      icon: "https://cdn/discord-icon.png",
      ProjectPagePanel: StubSettings as unknown as ChannelDefinition["ProjectPagePanel"],
      bridgeTools: [
        {
          name: "post_message",
          description: "Post a message to a room",
          inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          handler: () => undefined,
        },
      ],
      readPolicy: {
        canReadAllMessages: { configurable: true, defaultOn: true },
        canReadPresence: { configurable: false, defaultOn: false },
        canReadRoles: { configurable: true, defaultOn: true },
        nativeIntents: ["Guilds", "MessageContent"],
      },
    });
    const out = defineChannelV2(def);
    expect(out.bridgeTools).toHaveLength(1);
    expect(out.readPolicy.nativeIntents).toEqual(["Guilds", "MessageContent"]);
    expect(out.ProjectPagePanel).toBeDefined();
  });
});

describe("defineChannelV2 — validation errors", () => {
  it("throws when id is empty", () => {
    expect(() => defineChannelV2(minimalDef({ id: "" }))).toThrow(/id.*is required/);
    expect(() => defineChannelV2(minimalDef({ id: "   " }))).toThrow(/id.*is required/);
  });

  it("throws when displayName is empty", () => {
    expect(() => defineChannelV2(minimalDef({ displayName: "" }))).toThrow(/displayName/);
  });

  it("throws when createProtocol is not a function", () => {
    expect(() =>
      defineChannelV2(minimalDef({ createProtocol: undefined as never })),
    ).toThrow(/createProtocol/);
  });

  it("throws when bridgeTools is not an array", () => {
    expect(() =>
      defineChannelV2(minimalDef({ bridgeTools: undefined as never })),
    ).toThrow(/bridgeTools/);
  });

  it("throws when readPolicy is missing", () => {
    expect(() =>
      defineChannelV2(minimalDef({ readPolicy: undefined as never })),
    ).toThrow(/readPolicy/);
  });

  it("throws when a readPolicy toggle is missing required booleans", () => {
    expect(() =>
      defineChannelV2(
        minimalDef({
          readPolicy: {
            canReadAllMessages: { configurable: true, defaultOn: false },
            canReadPresence: { configurable: "yes" as unknown as boolean, defaultOn: false },
            canReadRoles: { configurable: true, defaultOn: true },
          },
        }),
      ),
    ).toThrow(/canReadPresence/);
  });
});

describe("ChannelEvent discriminated union — type-level smoke test", () => {
  it("narrows on `kind`", () => {
    const e: ChannelEvent = {
      kind: "message",
      message: {
        messageId: "m1",
        roomId: "r1",
        authorId: "u1",
        text: "hi",
        sentAt: new Date(0).toISOString(),
        mentionsBot: false,
      },
    };
    if (e.kind === "message") {
      // TS narrows to the message variant — accessing .message is type-safe.
      expect(e.message.messageId).toBe("m1");
    }
  });

  it("accepts all 10 event kinds at the type boundary", () => {
    const events: ChannelEvent[] = [
      { kind: "message", message: { messageId: "m", roomId: "r", authorId: "u", text: "", sentAt: "", mentionsBot: false } },
      { kind: "message-edit", message: { messageId: "m", roomId: "r", authorId: "u", text: "", sentAt: "", mentionsBot: false } },
      { kind: "message-delete", messageId: "m", roomId: "r" },
      { kind: "user-join", userId: "u", roomId: "r" },
      { kind: "user-leave", userId: "u", roomId: "r" },
      { kind: "presence-change", userId: "u", presence: "online" },
      { kind: "reaction-add", messageId: "m", userId: "u", emoji: "👍" },
      { kind: "reaction-remove", messageId: "m", userId: "u", emoji: "👍" },
      { kind: "ready", identity: { botId: "b", botName: "Aion" } },
      { kind: "error", error: "boom" },
    ];
    expect(events).toHaveLength(10);
  });
});

describe("ChannelRoom — schema flexibility", () => {
  it("accepts open-ended `kind` string for channel-specific vocabulary", () => {
    const slackHuddle: ChannelRoom = {
      roomId: "C12345:huddle",
      label: "Standup huddle",
      kind: "huddle", // Slack-specific; not in the closed set but typed as `string` extension
      privacy: "public",
    };
    expect(slackHuddle.kind).toBe("huddle");
  });
});
