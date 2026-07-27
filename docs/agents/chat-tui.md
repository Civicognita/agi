# Aion Chat TUI (`agi chat`): System Reference

`agi chat` is a terminal chat client for Aion itself — modeled closely on
Claude Code's own UX — not a specialized job/status browser. It reuses the
existing chat WebSocket protocol (the same one `ui/dashboard/src/components/
ChatFlyout.tsx` speaks), so it gets full owner-tier access: the same tool
registry, the same ability to dispatch and monitor Taskmaster through normal
conversation, no separate approve/reject screen.

## Container model

The folder `agi chat` is launched in (its `cwd` at invocation) is the **Chat
Container** — not a picker over `/api/projects`-registered projects. This
mirrors Claude Code directly: `cd` into any folder, run the chat client,
that folder is what you're chatting about.

This works because chat's `context` (the string carried on `chat:open` /
`chat:send`, `packages/gateway-core/src/server.ts`'s WS handler) was already
just a plain path with no registration requirement —
`ProjectConfigManager.read()` returns `null` (not a throw) for an
unregistered path, and `chatProjectPath` flows straight through to
`agentInvoker.process()` regardless. An arbitrary, never-registered folder
already worked end-to-end for chat before this ship; `agi chat` is simply the
first client built around that fact deliberately.

**CLI wrapper note**: `scripts/agi-cli.sh`'s `chat)` route has to `cd` into
the dev source tree to run the TS entrypoint, which would otherwise make
`process.cwd()` always resolve to that tree instead of wherever the user
actually ran `agi chat`. It captures `$PWD` into `AGI_CHAT_CALLER_CWD` before
the `cd`; `cli/src/commands/chat.ts` reads that env var as its container
path (falling back to plain `process.cwd()` for direct dev invocation, where
there's no `cd` in the way).

## `.agi` envelope awareness

If the container (or a nearby ancestor, searched up to 4 levels) is an `.agi`
envelope root — a directory with both `project.json` and an `.ai/`
subdirectory — the gateway folds its loop-state into the chat turn's system
prompt as context: `AGENTS.md`/`CLAUDE.md` content, plus a short headline
extracted from `.ai/plans/_next/checkpoint.mdc`'s YAML frontmatter
(`activeFocus`, `lastShipped.version`, `pendingQuestions`).

**This is pure context, never identity.** Aion's actual system prompt/persona
is assembled first and is never rewritten by project docs — see
`assembleSystemPromptWithBreakdown` in `packages/gateway-core/src/
system-prompt.ts`, which pushes PRIME/persona content first and only ever
*appends* project-derived sections afterward. The relevant functions:

- `buildProjectContextSection(projectPath, notes)` — the per-turn function
  already gated only on `ctx.projectPath !== undefined` (no dev-mode
  requirement, unlike the older `buildWorkspaceContextSection`/`devMode`
  path). Extended this ship to also call:
  - `readProjectInstructionsExcerpt(projectPath)` — reads `AGENTS.md`
    (preferred) or `CLAUDE.md` (fallback — many repos symlink one to the
    other), truncated to 500 chars.
  - `readAgiEnvelopeContext(projectPath)` — the envelope walk-up +
    checkpoint.mdc summary described above.

Because this hangs off the SAME per-turn `projectPath`-gated code path the
dashboard's own project-scoped chat already uses, both clients get this
context identically — there was no need to add a new per-client flag or
touch the pre-existing `devMode`/`buildWorkspaceContextSection` gate at all.

## On-demand `.mcp.json` loading

Chat's own tool loop reaches MCP servers today via a generic `mcp` tool
(`server.ts` ~3008-3062, proxying to the shared `McpClient`) — the LLM calls
it with `action=call/list-servers/list-tools`. That part was already true for
any *registered* project (its `.mcp.json` gets swept into `McpClient` at
gateway boot, namespaced `<projectSlug>:<serverId>`).

An ad hoc Chat TUI container usually isn't a registered project, so it was
never part of that boot-time sweep. `server.ts`'s `chat:open` handler now
calls `ensureProjectMcpRegistered(fullPath, label)` — the exact same
`.mcp.json`-reading logic the boot sweep uses, extracted into a reusable
function — for any `context` that looks like a real, existing folder path
(not `"general"`/`"builder:"`/`"mapp:"`/`"help:"`). This means a Chat TUI
container's own `.mcp.json` (Claude Code's own convention — no
`project.json` requirement at all for this on-demand path, unlike the
boot-sweep call site which still requires `project.json` to preserve its
original behavior) gets registered the moment you open a chat session there,
so the `mcp` tool can reach it in that same conversation.

Registration is idempotent (`McpClient.registerServer` id-keys by
`<projectSlug>:<serverId>`) and non-fatal — a chat session still opens even
if `.mcp.json` registration fails for some reason.

## Protocol

`packages/gateway-core/src/chat-ws-types.ts` documents the wire shapes
(`ChatClientMessage`/`ChatServerMessage`) that `server.ts`'s WS handler has
always implemented ad hoc as string-literal `case`s — purely additive typing
for `cli/src/chat-client.ts` to import; it does not change `server.ts`'s
actual handler logic. Covers the subset a plain chat client needs
(`chat:open`/`send`/`cancel`/`close` in; `chat:opened`/`thinking`/
`tool_start`/`tool_result`/`progress`/`thought`/`response`/`error`/
`cancelled`/`closed` out) — dashboard-only messages (plan approve/reject,
inject, history, suggestions) are out of scope.

`cli/src/chat-client.ts`'s `ChatClient` connects to `ws://<host>:<port>/ws`
using Node's built-in global `WebSocket` (stable since Node 22; this repo
requires `>=22.12.0` — no new dependency). No auth token is needed for a
localhost connection: `ws-server.ts`'s `verifyClient` auto-allows any
private-network IP (loopback included) before it ever checks for a token.

**A turn never hangs forever, but is patient with long ones.** The
`sendTimeoutMs` option (default 120s, `agi chat --timeout <seconds>`) is an
**INACTIVITY deadline, not a total-duration cap**. Every inbound turn-activity
event (`chat:thinking`/`tool_start`/`tool_result`/`progress`/`thought`) resets
the timer via the pending turn's `keepAlive()`, so an agentic turn that keeps
reporting progress — many tool calls over several minutes — never times out.
Only genuine silence for `sendTimeoutMs` (the original "stuck at
`chat:thinking` with no further events" failure) rejects with
`ChatTimeoutError` and fires a best-effort `chat:cancel` (not awaited).
`cancel()` also rejects the in-flight turn's promise immediately, client-side,
rather than waiting for the server's `chat:cancelled` echo — that round-trip
can itself hang if the server is genuinely stuck.

This replaced an earlier flat 120s cap that surfaced a real (2026-07-23)
bug: a legitimately long tool-heavy turn timed out with a `ChatTimeoutError`
even though the server completed it and persisted the response — so
reconnecting showed the answer that the live session had given up on. The
flat cap punished long-but-active turns; the inactivity model keeps them
alive while still catching the genuine-hang case the timeout was added for
(2026-07-16, a turn stuck at `chat:thinking` with Ctrl-C not recovering it).

**`--debug <path>`** streams every `ChatClient` event — outbound WS sends,
inbound frames (parsed, or a `parse-error` event if a frame isn't valid
JSON), and connection-lifecycle events (`ws:connecting`/`ws:open`/
`ws:error`/`ws:close`, `send:timeout`, `cancel()`) — as JSONL to the given
file via `ChatClientOptions.debugSink`. This only covers the client's own
view of the wire; a turn that hangs *server-side* (no response ever sent)
needs `agi logs` on the gateway, which this flag can't see — a real
2026-07-19 incident (the same class of hang the timeout above guards
against) turned out to be exactly that: `AnthropicProvider`'s retry loop had
no logging at all, so a stuck turn looked identical to a genuinely
in-progress one from the logs. See `packages/gateway-core/src/llm/
anthropic-provider.ts`'s `invoke()` for the server-side fix —
request-lifecycle logging plus disabling the Anthropic SDK's own redundant
internal retry layer (which compounded on top of the provider's own retry
loop with nothing logged in between).

## Rendering: full-window layout on `@particle-academy/fancy-tui`

`agi chat`'s interactive UI (`cli/src/chat-tui/App.tsx`) is a full-window Ink
app built mostly on `@particle-academy/fancy-tui` — the terminal/Ink
counterpart to the Fancy UI kit used throughout the dashboard. A few small
owned components exist because sealed fancy-tui components had bugs Aion
filed (see **Owned components & the focus-freeze rule** below); everything
else is the library's.

- **`chat.ts`'s `runInkChat` takes over the terminal's alternate screen
  buffer** (`\x1b[?1049h` on start, `\x1b[?1049l` on exit, the same mechanism
  vim/htop/less use) so `agi chat` starts from a blank canvas exactly the
  size of the terminal — like Claude Code — rather than printing inline
  wherever the shell cursor happened to be. The prior shell scrollback is
  preserved underneath and reappears untouched on exit. Ink's `render()` has
  no notion of this on its own; it's applied imperatively around `render()`/
  `waitUntilExit()` in a `try/finally`, gated on `process.stdout.isTTY`.
- **`useChatSession.ts`** is the only file that touches `ChatClient` directly
  — it translates the client's callback-based events into React state:
  `messages: ChatMessage[]` (committed scrollback; `ChatMessage` is a
  superset of fancy-tui's `MessageData` adding `attachments` for unpacked
  0REALTALK terminals and a `thinking` flag for reasoning blocks),
  `thinking`/`statusText` (live status), `liveToolCalls` (in-flight tool
  calls, folded into `messages` on resolve). Its `send(wireText, {displayText,
  attachments})` splits what reaches Aion from what the bubble shows (see the
  0REALTALK section).
- **`App.tsx`** composes `Screen` → `Header` → the scrollable message pane →
  `LiveRegion` (thinking spinner + in-flight `ToolCall`, hidden under
  `--quiet`) → the help/decode `Callout`s → `PromptInput` → `StatusBar`. Each
  message renders directly (not via fancy-tui's `<MessageList>`, which packs
  entries gap-free), wrapped in `Box marginBottom={1}`; agent replies get a
  🍄 `Avatar` sibling in the same `Row` (`Message` is sealed with no avatar
  slot).

### Owned components & the focus-freeze rule

**The hard-won rule: nothing in this TUI may hold Ink keyboard focus except
the input — and the input must not depend on focus at all.** Ink blurs the
active component on *every Escape* (`ink/build/components/App.js`: `if (input
=== escape && isFocusEnabled) setActiveFocusId(undefined)`). Any component
that gates its `useInput` on `isFocused` therefore goes permanently dead the
moment Esc (or any focusable stealing focus) blurs it — the whole TUI freezes,
with no typing/arrows/Esc/recovery. This froze the TUI **twice** during
development: first via fancy-tui's `Composer` (needed an explicit `focus()`
call), then via `Command`'s and `Modal`'s focusable `<Button>` children.

Consequences, all deliberate:
- **`PromptInput`** (`cli/src/chat-tui/PromptInput.tsx`) replaces fancy-tui's
  `Composer`. It does **not** use Ink's focus system at all — it always
  accepts input and always shows the caret. It's built on fancy-tui's own
  exported text-buffer primitives (`createTextBuffer`/`reduceTextBuffer`); the
  key→action mapping and caret model are the pure, unit-tested
  `prompt-input-logic.ts`. Fixes i-004 (arrow keys — `Composer` dropped
  `cursor`/`onCursorChange`) and i-005 (caret invisible on empty input;
  upstream as fancy-tui#2). Enter submits; Alt+Enter always inserts a newline,
  Shift+Enter only when `useFancyTui().capabilities.shiftEnter` is true.
- **No focusable palette / modal / accordion.** Slash-command matches render
  as plain non-focusable `Text` (selection is exact-match-on-Enter in
  `handleSubmit`). `/help` is a dismissible `Callout` (Esc or type to close),
  not a `Modal` (whose `Close` button is focusable). Reasoning blocks collapse
  via a **global Ctrl+T toggle**, not a focusable per-block `Accordion`. A
  proper non-focus-stealing `Drawer`/`Accordion` is requested upstream as
  fancy-tui#4; until then, keyboard-global toggles are the pattern.
- **Scrollable message pane (i-006).** The alt-screen takeover suppresses the
  terminal's native scrollback, so history scrolls in-app: a bottom-anchored,
  overflow-clipped `Box` windowed by `message-viewport.ts` (pure, unit-tested)
  — PageUp/PageDown page through, Escape jumps to latest, new messages
  auto-follow when at the bottom. (fancy-tui has no scrollable-viewport
  primitive; requested as fancy-tui#3.)

### 0REALTALK shorthands (recognize · route · unpack)

The input is a 0REALTALK "stream of consciousness": the user pours layered
context and multiple chained/unchained requests into one message, and the TUI
surfaces the structure (owner directive 2026-07-22). Grounded in the corpus
(`repos/prime/docs/triggers.md`, `core/truth/chained-triggers.md`,
`lexicon/definitions/magic-terminal.md`, `WIP/knowledge/0R-whitepaper.md` §4/§5).
`realtalk-stream.ts` tokenizes + folds the stream (all pure, unit-tested):

- **Triggers** (`:word:` and chained `:action:scope:target:`) — passed THROUGH
  to Aion verbatim; Aion executes their semantics server-side. The TUI only
  recognizes + live-decodes them in the `0REALTALK` `Callout`.
- **`n>` switch** — splits the stream into an ordered request queue. Each
  request is sent one at a time as the previous turn completes (a drain
  effect); the status bar shows `n> N queued` while draining.
- **Terminals** (`:( … ):`) — a terminal's inner expression is NOT sent
  verbatim. `extractTerminals` pulls it from the prose, `realtalk-unpacker.ts`
  UNPACKS it (first-pass stub — decodes recognized 0REALTALK, else passes the
  content through under an `⟦0REALTALK unpacked⟧` label; the real de/compiler
  lands later), and the unpacked OUTPUT is what reaches Aion (`buildWireMessage`).
  The user's bubble shows the prose plus the raw terminal as a distinct
  attachment (`▣ 0REALTALK · :( … ):`). Sending the terminal verbatim was a
  bug — a strip/route pass corrupted terminals with inner parens (e.g.
  `:(TEST(0R 00 0RAW)):`); the extract→unpack→wire path is the fix, and the
  message is otherwise sent verbatim so triggers/parens survive.
- **Reasoning blocks** — persisted `thought`-role messages (and any content
  leaking `<thinking>` tags) render collapsed by default to a one-line summary
  (`thinking-display.ts`); **Ctrl+T** toggles all expanded/collapsed.

`/help` lists the slash commands and this shorthand reference.

### Non-TTY fallback

**A hard requirement, not a nicety.** Ink cannot render a full-screen layout
without a real terminal. `chat.ts` checks `process.stdin.isTTY` and runs the
*original* plain-text `readline` REPL (`runReadlineChat`) for
piped/non-interactive invocation — the same `ChatClient`, same timeout/cancel
behavior, just printed output instead of a rendered layout. `runInkChat` (the
Ink path) is the default only when stdin is a real TTY.

## Scope of this ship

- **Workspace-scoped session resume.** `registerChatCommand` calls the
  existing `GET /api/chat/sessions` (via `GatewayClient.chatSessions()`)
  before opening the WS connection, filters to sessions whose `context`
  matches the resolved container path, and auto-picks the most recently
  updated one as `resumeSessionId` — passed to `ChatClient.open(context,
  sessionId)`, which already supported resuming (unchanged). `useChatSession`
  hydrates the resumed session's prior `messages` into the transcript on
  `chat:opened` via a new `historyLoaded` reducer action.  `--session <id>`
  overrides the auto-pick explicitly; `--new-session` forces a fresh session
  even when a prior one exists. A gateway that's unreachable or too old to
  have this endpoint just falls through to a fresh session — the failure
  mode is silent-and-safe, not a hard error. Still single active session
  *per running `agi chat` process* — switching between multiple saved
  sessions from inside a running session (not just at launch) remains a
  fast-follow.
- **Slash commands** (`/quit`, `/exit`, `/clear`, `/help`) — matched as the
  user types `/`, selected by exact-match-on-Enter, rendered as plain
  non-focusable text (see the focus-freeze rule above for why not a
  `Command`/`Modal`). `/clear` empties the visible scrollback only (the
  server's saved history is untouched); `/help` is a dismissible `Callout`,
  not injected into the persisted transcript.
- **0REALTALK shorthands + single-expression reader.** The stream layer
  (triggers / `n>` / terminals / unpacker) is described in the rendering
  section above. Separately, `realtalk-reader.ts`'s `parseRealtalk()` decodes
  a whole-input *single* expression — accessor `<FRAME>STATION>ROLE`
  (`core/0ACCESSOR.md`), `|+value|` confidence, `:seg:seg:` impact marks,
  `+$imp`/`-$imp`, and LAW-status lexicon terms (`core/0TERMS.md`) — shown in
  the `0REALTALK` `Callout`. It's deliberately Phase-1 recognition only, per
  the corpus's own scoping (`evolution/musings/0realtalk-engine.md`: "0READER
  parses known patterns from lexicon... Validation = lexicon membership") — it
  does not execute, validate alignment, or resolve the corpus's open questions
  (what runs compiled 0REALTALK, whether it's "the language of SENTIENCE").
- No real token-by-token streaming — `chat:response` delivers the full
  answer in one frame (the gateway's `AnthropicClient` call is
  non-streaming today), same as the dashboard. Tool activity/thinking/
  progress events (rendered live via `LiveRegion`/`Spinner`/`ToolCall`) are
  what make a turn feel live.
- `.agi` envelope awareness is detection + context only. Actual
  Claude-Code-style hook *execution* (SessionStart/Stop-equivalent hooks)
  is explicitly out of scope for this pass.
