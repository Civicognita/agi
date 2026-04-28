#!/usr/bin/env node
/**
 * Empirical chat-latency probe for t326.
 *
 * Connects to the gateway WebSocket, sends a single user message, and times
 * the round-trip from chat:send → first chat_response. Designed to be run
 * inside the test VM against http://127.0.0.1:3100, but the URL and prompt
 * are env-overridable.
 *
 * Usage (inside VM):
 *   PROMPT="hi" node /mnt/agi/scripts/probe-local-chat-latency.mjs
 *
 * Env:
 *   GW_URL    Override gateway WS URL (default ws://127.0.0.1:3100/ws)
 *   PROMPT    User message (default "hi")
 *   TIMEOUT   Hard cap in seconds (default 360)
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("/mnt/agi/node_modules/.pnpm/ws@8.19.0/node_modules/ws");

const url = process.env.GW_URL ?? "ws://127.0.0.1:3100/ws";
const prompt = process.env.PROMPT ?? "hi";
const timeoutMs = (Number.parseInt(process.env.TIMEOUT ?? "360", 10)) * 1000;

const sessionId = `probe-${Date.now()}`;
const t0 = Date.now();
let firstResponseAt = null;
let finalText = "";
let toolCount = 0;
let loopCount = 0;
let routingMeta = null;

const ws = new WebSocket(url);

const hardTimer = setTimeout(() => {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`PROBE TIMEOUT after ${elapsed}s (cap=${timeoutMs / 1000}s)`);
  process.exit(2);
}, timeoutMs);

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "chat:send",
    payload: { sessionId, text: prompt },
  }));
});

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (process.env.VERBOSE === "1") {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.error(`[${elapsed}s] ${msg.type} :: ${JSON.stringify(msg).slice(0, 220)}`);
  }
  if (msg.type === "chat:response" || msg.type === "chat_response") {
    if (firstResponseAt === null) firstResponseAt = Date.now();
    const p = msg.payload ?? msg;
    finalText = p.text ?? p.content ?? "";
    toolCount = p.toolCount ?? 0;
    loopCount = p.loopCount ?? 0;
    routingMeta = p.routingMeta ?? null;
    clearTimeout(hardTimer);
    const elapsed = ((firstResponseAt - t0) / 1000).toFixed(2);
    console.log(`elapsed_s=${elapsed}`);
    console.log(`first_response_chars=${finalText.length}`);
    console.log(`tools_used=${toolCount}`);
    console.log(`loop_count=${loopCount}`);
    if (routingMeta) {
      console.log(`routing.costMode=${routingMeta.costMode}`);
      console.log(`routing.selectedModel=${routingMeta.selectedModel}`);
      console.log(`routing.contextLayers=${(routingMeta.contextLayers ?? []).join(",")}`);
    }
    console.log("---");
    console.log(finalText.slice(0, 200));
    ws.close();
    process.exit(0);
  }
  if (msg.type === "chat:error" || msg.type === "error") {
    clearTimeout(hardTimer);
    console.error(`PROBE ERROR: ${JSON.stringify(msg)}`);
    ws.close();
    process.exit(1);
  }
});

ws.on("error", (err) => {
  clearTimeout(hardTimer);
  console.error(`WS_ERROR: ${err.message}`);
  process.exit(1);
});
