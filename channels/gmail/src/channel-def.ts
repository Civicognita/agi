/**
 * Gmail channel definition built against the defineChannelV2 SDK (CHN-A s162).
 * This is the s171 CHN-J migration target.
 *
 * **Status — 2026-05-15:** wired into index.ts activate() via registerChannelV2
 * in PARALLEL to the legacy registerChannel() path. Full legacy-path removal
 * is deferred to s174 CHN-M after all adapters are migrated.
 *
 * Room model: thread:${threadId} — each Gmail thread is a ChannelRoom.
 * Discovery: category-based — Gmail labels/categories (INBOX, SENT, etc.) are
 * the structural discovery mechanism; rooms (threads) appear as messages arrive.
 *
 * Protocol method → GmailClient mapping:
 *   | Protocol method   | Implementation                                    |
 *   |-------------------|---------------------------------------------------|
 *   | start()           | healthCheck() + setInterval polling               |
 *   | onEvent(handler)  | event handler registration                        |
 *   | listRooms()       | seenThreads registry (populated on inbound msgs)  |
 *   | getRoom(roomId)   | seenThreads cache                                 |
 *   | subscribeRoom()   | onEvent + roomId filter                           |
 *   | postToRoom()      | client.sendMessage() with cached thread context   |
 *   | searchMessages()  | unsupported — returns empty                       |
 *   | getUser(userId)   | userId = senderEmail; basic ChannelUser           |
 *   | listMembers()     | unsupported — returns empty                       |
 *
 * Reference: agi/docs/agents/channel-plugin-redesign.md §4 + §11 (CHN-J).
 */

import {
  defineChannelV2,
  type ChannelDefinition,
  type ChannelProtocol,
  type ChannelContext,
  type ChannelEvent,
  type ChannelMessage,
  type ChannelRoom,
  type ChannelUser,
} from "@agi/sdk";

import type { EmailConfig } from "./config.js";
import { GMAIL_CHANNEL_ID, extractSenderEmail, extractBodyText } from "./normalizer.js";
import { GmailClient, type GmailRawMessage } from "./gmail-client.js";
import type { gmail_v1 } from "googleapis";

// ---------------------------------------------------------------------------
// Room ID helpers
// ---------------------------------------------------------------------------

export function encodeRoomId(threadId: string): string {
  return `thread:${threadId}`;
}

export function decodeThreadId(roomId: string): string {
  return roomId.startsWith("thread:") ? roomId.slice("thread:".length) : roomId;
}

// ---------------------------------------------------------------------------
// Inbound message normalizer
// ---------------------------------------------------------------------------

interface ThreadInfo {
  room: ChannelRoom;
  senderEmail: string;
  subject: string;
  lastMessageId: string;
  lastReferences: string;
}

interface ThreadEvent {
  event: ChannelEvent;
  threadInfo: ThreadInfo;
  roomId: string;
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  const h = headers.find((h) => (h.name ?? "").toLowerCase() === lower);
  return h?.value ?? undefined;
}

function ensureRePrefix(subject: string): string {
  if (/^re:/i.test(subject)) return subject;
  return `Re: ${subject}`;
}

function rawToThreadEvent(raw: GmailRawMessage, selfAddress: string): ThreadEvent | null {
  const headers = raw.payload.headers ?? [];
  const from = getHeader(headers, "From") ?? "";
  const subject = getHeader(headers, "Subject") ?? "(no subject)";
  const messageId =
    getHeader(headers, "Message-ID") ??
    getHeader(headers, "Message-Id") ??
    "";
  const references = getHeader(headers, "References") ?? "";

  const senderEmail = extractSenderEmail(from);

  if (senderEmail.toLowerCase() === selfAddress.toLowerCase()) return null;

  const bodyText = extractBodyText(raw.payload);
  if (bodyText === null || bodyText.trim().length === 0) return null;

  const roomId = encodeRoomId(raw.threadId);

  const room: ChannelRoom = {
    roomId,
    label: subject !== "(no subject)" ? subject : `Email from ${senderEmail}`,
    kind: "thread",
    privacy: "private",
  };

  const refsChain = references
    ? `${references} ${messageId}`.trim()
    : messageId;

  const message: ChannelMessage = {
    messageId: raw.id,
    roomId,
    authorId: senderEmail.toLowerCase(),
    text: bodyText,
    sentAt: new Date(Number(raw.internalDate)).toISOString(),
    mentionsBot: true, // all inbound email to this account is directed at us
  };

  return {
    event: { kind: "message", message },
    threadInfo: {
      room,
      senderEmail: senderEmail.toLowerCase(),
      subject,
      lastMessageId: messageId,
      lastReferences: refsChain,
    },
    roomId,
  };
}

// ---------------------------------------------------------------------------
// Protocol implementation
// ---------------------------------------------------------------------------

function buildProtocol(config: EmailConfig, _ctx: ChannelContext): ChannelProtocol {
  const client = new GmailClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
  });

  const eventHandlers: Array<(e: ChannelEvent) => void> = [];
  // Populated as inbound messages arrive — Gmail's category-based discovery model.
  const seenThreads = new Map<string, ThreadInfo>();

  const processedIds = new Set<string>();
  let lastHistoryId: string | null = null;
  const pollingIntervalMs = config.pollingIntervalMs ?? 15_000;
  const maxAgeMinutes = config.maxAgeMinutes ?? 30;
  const label = config.label ?? "INBOX";
  let timer: ReturnType<typeof setInterval> | null = null;

  async function poll(): Promise<void> {
    try {
      const result = await client.pollNewMessages(lastHistoryId, maxAgeMinutes, label);
      if (result.latestHistoryId !== null) {
        lastHistoryId = result.latestHistoryId;
      }
      for (const raw of result.messages) {
        if (processedIds.has(raw.id)) continue;
        processedIds.add(raw.id);

        // Cap dedup set size to prevent unbounded memory growth.
        if (processedIds.size > 5000) {
          const iter = processedIds.values();
          for (let i = 0; i < 1000; i++) {
            const next = iter.next();
            if (next.done) break;
            processedIds.delete(next.value);
          }
        }

        const parsed = rawToThreadEvent(raw, config.account);
        if (parsed === null) continue;

        seenThreads.set(parsed.roomId, parsed.threadInfo);

        try {
          await client.markAsRead(raw.id);
        } catch {
          // best-effort
        }

        for (const h of eventHandlers) h(parsed.event);
      }
    } catch (err) {
      console.warn(
        "[gmail] Poll error:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    start: async () => {
      try {
        const profile = await client.healthCheck();
        console.log(`[gmail] Gmail API healthy — account: ${profile.email}`);
        lastHistoryId = profile.historyId;
      } catch (err) {
        console.warn(
          "[gmail] Gmail API unreachable at startup — polling will retry:",
          err instanceof Error ? err.message : String(err),
        );
      }
      timer = setInterval(() => { void poll(); }, pollingIntervalMs);
      return {
        stop: async () => {
          if (timer !== null) {
            clearInterval(timer);
            timer = null;
          }
        },
      };
    },

    onEvent: (handler) => {
      eventHandlers.push(handler);
      return () => {
        const i = eventHandlers.indexOf(handler);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },

    listRooms: async () => [...seenThreads.values()].map((t) => t.room),

    getRoom: async (roomId) => seenThreads.get(roomId)?.room ?? null,

    subscribeRoom: (roomId, handler) => {
      const filtered = (event: ChannelEvent) => {
        if (
          (event.kind === "message" || event.kind === "message-edit") &&
          event.message.roomId !== roomId
        ) return;
        handler(event);
      };
      eventHandlers.push(filtered);
      return () => {
        const i = eventHandlers.indexOf(filtered);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },

    postToRoom: async (roomId, message) => {
      const info = seenThreads.get(roomId);
      const threadId = decodeThreadId(roomId);

      await client.sendMessage(
        info?.senderEmail ?? "",
        info ? ensureRePrefix(info.subject) : "(no subject)",
        message.text,
        threadId,
        info?.lastMessageId,
        info?.lastReferences,
      );

      return {
        messageId: `sent-${Date.now().toString()}`,
        roomId,
        authorId: config.account,
        text: message.text,
        sentAt: new Date().toISOString(),
        mentionsBot: false,
      };
    },

    // Gmail API has full search support but it is out of scope for the initial
    // migration — full-text search via q= parameter is deferred to a follow-up.
    searchMessages: async (_roomId, _opts) => ({ messages: [] }),

    getUser: async (userId): Promise<ChannelUser | null> => ({
      userId,
      displayName: userId,
      username: userId,
      avatarUrl: undefined,
    }),

    listMembers: async (_scope) => [],
  };
}

// ---------------------------------------------------------------------------
// Factory + definition
// ---------------------------------------------------------------------------

const StubSettingsPage = () => null;

/**
 * Build a v2 ChannelDefinition for Gmail.
 * Registered via api.registerChannelV2() in index.ts activate().
 */
export function createGmailChannelDefV2(config: EmailConfig): ChannelDefinition {
  return defineChannelV2({
    id: GMAIL_CHANNEL_ID,
    displayName: "Gmail",
    icon: undefined,
    createProtocol: (ctx) => buildProtocol(config, ctx),
    SettingsPage: StubSettingsPage as unknown as ChannelDefinition["SettingsPage"],
    bridgeTools: [],
    readPolicy: {
      canReadAllMessages: { configurable: false, defaultOn: true },
      canReadPresence: { configurable: false, defaultOn: false },
      canReadRoles: { configurable: false, defaultOn: false },
      nativeIntents: [],
    },
    roomDiscovery: { model: "category-based" },
  });
}
