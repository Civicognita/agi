/**
 * `agi chat`'s full-window layout — composed mostly from
 * `@particle-academy/fancy-tui` primitives (see `docs/agents/chat-tui.md`).
 * Two small owned pieces exist because sealed fancy-tui components had bugs
 * Aion filed: `PromptInput` (i-004/i-005 — arrow keys + caret) and the
 * scrollable message pane below (i-006 — alt-screen suppresses terminal
 * scrollback, so history is scrolled in-app via `message-viewport`).
 */

import { useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import {
  FancyTuiProvider,
  Screen,
  Header,
  Message,
  Box,
  Avatar,
  LiveRegion,
  Spinner,
  ToolCall,
  Row,
  Text,
  StatusBar,
  KeyHint,
  Badge,
  Callout,
  useFancyTui,
  useTerminalSize,
  type Option,
} from "@particle-academy/fancy-tui";
import { PromptInput } from "./PromptInput.js";
import { useChatSession, type TerminalAttachment } from "./useChatSession.js";
import { parseRealtalk } from "./realtalk-reader.js";
import { tokenizeStream, foldStream, extractTerminals } from "./realtalk-stream.js";
import { unpackTerminal, buildWireMessage } from "./realtalk-unpacker.js";
import { isThinkingContent, stripThinkingTags, thinkingSummary } from "./thinking-display.js";
import { clampScroll, computeViewportWindow } from "./message-viewport.js";
import type { ChatClientOptions } from "../chat-client.js";

/** One request ready to send: `wire` reaches Aion (prose + unpacked terminals); `display` is the bubble prose; `attachments` render as distinct blocks. */
interface OutgoingMessage {
  wire: string;
  display: string;
  attachments: TerminalAttachment[];
}

/** 0REALTALK shorthand reference shown by `/help` — grounded in repos/prime/docs/triggers.md. Kept short-lined so it wraps cleanly on narrow terminals. */
const SHORTHAND_HELP = [
  "0REALTALK shorthands:",
  "  n>       next in queue — splits into ordered requests",
  "  :( ):    terminal / mode — e.g. :(translate):",
  "  :word:   trigger → Aion — :muse: :hard: :coa: :fix:",
  "  :a:b:c:  chained — action:scope:target",
].join("\n");

/** Known `/`-prefixed commands — deliberately small; extend here as new ones earn a slot. */
const SLASH_COMMANDS: Option[] = [
  { id: "/quit", label: "/quit", description: "Exit agi chat" },
  { id: "/exit", label: "/exit", description: "Exit agi chat (alias for /quit)" },
  { id: "/clear", label: "/clear", description: "Clear the visible conversation — local only, the server's saved history is untouched" },
  { id: "/help", label: "/help", description: "List available commands" },
];

export interface AppProps {
  containerPath: string;
  envelopeRoot: string | null;
  chatClientOptions: ChatClientOptions;
  /** Suppress the live thinking/tool-activity region — just committed messages. */
  quiet?: boolean;
  /** A saved session to resume — its history hydrates into the transcript on open. */
  resumeSessionId?: string;
}

function ConnectedApp({ containerPath, envelopeRoot, chatClientOptions, quiet = false, resumeSessionId }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { capabilities } = useFancyTui();
  const { height: termHeight } = useTerminalSize();
  const [draft, setDraft] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  // Reasoning ("thinking") blocks are collapsed by default (noise); Ctrl+T
  // toggles them all open/closed. A global toggle, not per-block — a focusable
  // per-block accordion would steal input focus and freeze the TUI.
  const [showThinking, setShowThinking] = useState(false);
  // Scroll position of the message pane: how many messages back from the
  // latest the newest-visible message is (0 = following the latest). See
  // message-viewport.ts for the model.
  const [scrollUp, setScrollUp] = useState(0);
  // Pending requests from an `n>`-split stream, sent one at a time as each
  // turn completes (see the drain effect below).
  const [queue, setQueue] = useState<OutgoingMessage[]>([]);

  const {
    messages,
    thinking,
    statusText,
    liveToolCalls,
    connectionState,
    connectionError,
    sessionId,
    send,
    cancel,
    clearMessages,
  } = useChatSession(containerPath, { ...chatClientOptions, resumeSessionId });

  // Message-pane windowing. Render budget is a generous estimate from terminal
  // height (~2 rows/message); overshoot clips harmlessly at the top edge,
  // undershoot just leaves blank space, and the bottom-anchored Box keeps the
  // newest-visible message pinned to the bottom either way.
  const renderCapacity = Math.max(6, Math.floor(termHeight / 2));
  const scrollStep = Math.max(1, renderCapacity - 1);
  const viewport = computeViewportWindow(messages.length, renderCapacity, scrollUp);
  const visibleMessages = messages.slice(viewport.startIndex, viewport.endIndex);

  // Keep the view anchored as new messages arrive: follow the latest when at
  // the bottom, otherwise stay on the same messages (shift scrollUp by the
  // number that just arrived below).
  const prevTotal = useRef(messages.length);
  useEffect(() => {
    const total = messages.length;
    const delta = total - prevTotal.current;
    prevTotal.current = total;
    if (delta > 0) setScrollUp((s) => (s > 0 ? clampScroll(s + delta, total) : 0));
  }, [messages.length]);

  // Drain the `n>` request queue: when the current turn finishes (thinking
  // false) and requests remain, send the next one. `send` sets thinking true
  // again, so this fires exactly once per completed turn until the queue empties.
  useEffect(() => {
    if (!thinking && queue.length > 0) {
      const [nextReq, ...rest] = queue;
      setQueue(rest);
      if (nextReq !== undefined) send(nextReq.wire, { displayText: nextReq.display, attachments: nextReq.attachments });
    }
  }, [thinking, queue, send]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (thinking) cancel();
      else exit();
      return;
    }
    // Ctrl+T — toggle all reasoning blocks expanded/collapsed.
    if (key.ctrl && input === "t") { setShowThinking((v) => !v); return; }
    // History scroll — PageUp/PageDown page through, Escape closes the help
    // panel (if open) then jumps to latest. PromptInput's own useInput handles
    // text/arrows; these keys don't overlap.
    if (key.pageUp) { setScrollUp((s) => clampScroll(s + scrollStep, messages.length)); return; }
    if (key.pageDown) { setScrollUp((s) => clampScroll(s - scrollStep, messages.length)); return; }
    if (key.escape) { setShowHelp(false); setScrollUp(0); return; }
  });

  const trimmedDraft = draft.trim();
  const isComposingCommand = trimmedDraft.startsWith("/");
  const commandMatches = isComposingCommand
    ? SLASH_COMMANDS.filter((c) => c.id.startsWith(trimmedDraft.toLowerCase()))
    : [];
  // Live 0REALTALK decode of the input stream — recognize/highlight only, never
  // alters what gets sent. `foldStream` decomposes the stream into triggers
  // (passed through to Aion), terminals (local modes), and n> switches (local
  // request queue); `parseRealtalk` still decodes a whole-input single
  // expression (accessor / confidence / term). Mutually exclusive with the
  // slash-command palette so the two previews never overlap.
  const stream = isComposingCommand ? null : foldStream(tokenizeStream(trimmedDraft), trimmedDraft);
  const singleExpr = isComposingCommand ? null : parseRealtalk(trimmedDraft);
  const hasStream =
    stream !== null &&
    (stream.triggers.length > 0 || stream.terminalDepth > 0 || stream.requests.length > 1 || stream.unbalancedClose);
  const decodeLines: string[] = [];
  if (stream !== null) {
    if (stream.terminalDepth > 0) decodeLines.push(`▣ terminal: ${stream.activeTerminal ?? "open"}${stream.terminalDepth > 1 ? ` · depth ${String(stream.terminalDepth)}` : ""}`);
    if (stream.unbalancedClose) decodeLines.push("unbalanced ): — no terminal open");
    if (stream.requests.length > 1) decodeLines.push(`queue (n>): ${String(stream.requests.length)} requests`);
    if (stream.triggers.length > 0) decodeLines.push(`triggers → Aion: ${stream.triggers.join(" ")}`);
  }
  if (!hasStream && singleExpr !== null) decodeLines.push(singleExpr.summary);
  const showDecode = decodeLines.length > 0 && !thinking;
  const decodeTone = stream?.unbalancedClose === true || singleExpr?.kind === "unrecognizedRootTerm" ? "warning" : "info";

  const handleDraftChange = (value: string): void => {
    setDraft(value);
    if (showHelp) setShowHelp(false);
  };

  const runSlashCommand = (id: string): void => {
    switch (id) {
      case "/quit":
      case "/exit":
        exit();
        return;
      case "/clear":
        clearMessages();
        return;
      case "/help":
        setShowHelp(true);
        return;
      default:
        return;
    }
  };

  const handleSubmit = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    if (trimmed.startsWith("/")) {
      // Exact match only — an ambiguous/partial slash command (e.g. just
      // "/" or "/qu") leaves the palette open below instead of guessing.
      const match = SLASH_COMMANDS.find((c) => c.id === trimmed.toLowerCase());
      if (!match) return;
      setDraft("");
      runSlashCommand(match.id);
      return;
    }
    // A turn is already in flight (e.g. the n> queue is draining) — ignore the
    // submit rather than trip ChatClient's "previous turn still in flight".
    if (thinking) return;

    // `n>` splits the stream into ordered requests. For each: pull out any
    // 0REALTALK terminals, run them through the unpacker, and send the prose +
    // the unpacked OUTPUT to Aion (`wire`). The bubble shows the prose
    // (`display`) with the raw terminals as distinct attachments. Triggers stay
    // in the prose and pass through (Aion executes them server-side).
    const outgoing: OutgoingMessage[] = foldStream(tokenizeStream(trimmed), trimmed).requests
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
      .map((r): OutgoingMessage => {
        const { prose, terminals } = extractTerminals(r);
        const unpacked = terminals.map(unpackTerminal);
        return {
          wire: buildWireMessage(prose, unpacked),
          display: prose,
          attachments: unpacked.map((u) => ({ raw: u.raw, output: u.output })),
        };
      })
      .filter((o) => o.wire.length > 0);

    setDraft("");
    if (outgoing.length === 0) return;
    const [first, ...rest] = outgoing;
    if (first !== undefined) send(first.wire, { displayText: first.display, attachments: first.attachments });
    setQueue(rest);
  };

  if (connectionState === "error") {
    return (
      <Screen>
        <Header title="agi chat" subtitle={containerPath} status={<Badge tone="danger">disconnected</Badge>} />
        <Callout title="Connection failed" tone="danger">
          {connectionError ?? "Unknown error"}
        </Callout>
        <StatusBar left={<KeyHint keys="Ctrl+C" label="exit" />} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title="agi chat"
        subtitle={containerPath}
        status={
          connectionState === "connecting"
            ? <Badge tone="warning">connecting…</Badge>
            : <Badge tone="success">connected</Badge>
        }
      />
      {/* In-app scrollable message pane (i-006). A bottom-anchored,
          overflow-clipped Box fills the space between header and input:
          the newest-visible message pins to the bottom, older messages fill
          upward and clip at the top edge. `message-viewport` decides the
          windowed slice; PageUp/PageDown/Escape (handled above) scroll it.
          Each message renders directly (not via fancy-tui's <MessageList>,
          which packs entries gap-free); agent replies get a mushroom Avatar
          alongside — Message is sealed with no avatar slot, so it's a sibling
          in the same Row. */}
      {!viewport.atBottom && (
        <Text tone="muted">↑ scrolled up · {String(viewport.hiddenBelow)} newer below · PgDn/Esc for latest</Text>
      )}
      <Box flexGrow={1} flexDirection="column" justifyContent="flex-end" overflow="hidden">
        {visibleMessages.map((m) => (
          <Box key={m.id} marginBottom={1} flexDirection="column">
            {isThinkingContent(m.content, m.thinking === true) ? (
              // Collapsible reasoning block — summary when collapsed, full
              // (tag-stripped) text when expanded (Ctrl+T toggles all).
              showThinking ? (
                <Box flexDirection="column">
                  <Text tone="muted">{thinkingSummary(m.content)} · Ctrl+T to collapse</Text>
                  <Box marginLeft={2}><Text tone="muted">{stripThinkingTags(m.content)}</Text></Box>
                </Box>
              ) : (
                <Text tone="muted">{thinkingSummary(m.content)} · Ctrl+T to expand</Text>
              )
            ) : m.role === "agent" ? (
              <Row>
                <Avatar name="Aion" glyph="🍄" />
                <Box flexGrow={1}>
                  <Message message={m} />
                </Box>
              </Row>
            ) : (
              <Message message={m} />
            )}
            {/* Unpacked 0REALTALK terminals attached to a user message —
                distinct blocks under the bubble (the raw terminal shown; the
                unpacked output is what was sent to Aion). */}
            {m.attachments?.map((a, i) => (
              <Box key={i} marginLeft={2}>
                <Text tone="tool">▣ 0REALTALK · {a.raw}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
      {!quiet && (
        <LiveRegion>
          {thinking && <Spinner label={statusText ?? "Aion is thinking…"} />}
          {liveToolCalls.map((call) => (
            <ToolCall key={call.id} call={call} />
          ))}
        </LiveRegion>
      )}
      {showHelp && (
        <Callout title="Commands · Esc or type to close" tone="info">
          {`${SLASH_COMMANDS.map((c) => `${c.label} — ${c.description ?? ""}`).join("\n")}\n\n${SHORTHAND_HELP}`}
        </Callout>
      )}
      {/* Matching slash commands as the user types "/" — plain, NON-focusable
          text. (A fancy-tui <Command> was used here before but its focusable
          <Button> children stole focus from the input and froze the UI; command
          selection is driven by exact-match-on-Enter in handleSubmit, so no
          focusable palette is needed.) */}
      {isComposingCommand && !thinking && commandMatches.length > 0 && (
        <Callout title="Commands" tone="info">
          {commandMatches.map((c) => `${c.label} — ${c.description ?? ""}`).join("\n")}
        </Callout>
      )}
      {showDecode && (
        <Callout title="0REALTALK" tone={decodeTone}>
          {decodeLines.join("\n")}
        </Callout>
      )}
      <PromptInput
        value={draft}
        onChange={handleDraftChange}
        onSubmit={handleSubmit}
        placeholder="Message Aion… (/quit to exit, /help for commands)"
      />
      <StatusBar
        left={
          <Row>
            <KeyHint keys="Ctrl+C" label={thinking ? "cancel" : "exit"} />
            <KeyHint keys="PgUp/PgDn" label="scroll" />
            <KeyHint keys="Ctrl+T" label="thinking" />
          </Row>
        }
        center={capabilities.shiftEnter ? undefined : <KeyHint keys="Alt+Enter" label="newline" />}
        right={
          <Row>
            {queue.length > 0 && <Badge tone="warning">n&gt; {String(queue.length)} queued</Badge>}
            {sessionId !== null && <Text tone="muted">sess:{sessionId.slice(0, 8)}</Text>}
            {envelopeRoot !== null && <Badge tone="info">.agi envelope</Badge>}
          </Row>
        }
      />
    </Screen>
  );
}

export function App(props: AppProps): React.JSX.Element {
  return (
    <FancyTuiProvider>
      <ConnectedApp {...props} />
    </FancyTuiProvider>
  );
}
