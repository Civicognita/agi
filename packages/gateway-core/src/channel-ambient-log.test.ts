/**
 * ChannelAmbientLog roomId scoping — guards the Discord cross-channel bleed.
 *
 * The "[Today's channel conversation]" preamble is provider-keyed (one daily
 * file for ALL Discord channels). Without a roomId filter, one channel's
 * messages (e.g. #Leadership's WEDC/Baseten) bled into another channel's prompt
 * (#water-cooler). getTodayContext(roomId) must return ONLY that room's entries.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelAmbientLog } from "./channel-ambient-log.js";

function tmpLog(): ChannelAmbientLog {
  return new ChannelAmbientLog(mkdtempSync(join(tmpdir(), "ambient-")));
}
const entry = (roomId: string, text: string) => ({ ts: "2026-07-07T12:00:00.000Z", authorId: "u", displayName: "A", text, roomId });

describe("ChannelAmbientLog roomId scoping", () => {
  it("returns ONLY the requested room's entries — no cross-channel bleed", () => {
    const log = tmpLog();
    log.log("discord", entry("g:leadership", "WEDC and Baseten opportunities"));
    log.log("discord", entry("g:watercooler", "anyone want coffee?"));

    const wc = log.getTodayContext("discord", 30, "g:watercooler");
    expect(wc.map((e) => e.text)).toEqual(["anyone want coffee?"]);
    expect(wc.some((e) => e.text.includes("WEDC"))).toBe(false);
  });

  it("without roomId returns ALL entries (provider-level, for the dashboard)", () => {
    const log = tmpLog();
    log.log("discord", entry("g:leadership", "a"));
    log.log("discord", entry("g:watercooler", "b"));
    expect(log.getTodayContext("discord", 30).length).toBe(2);
  });

  it("filters BEFORE the limit slice — a busy other-channel can't crowd out the target room", () => {
    const log = tmpLog();
    // 3 target-room entries FIRST, then 50 from a noisy other channel.
    for (let i = 0; i < 3; i++) log.log("discord", entry("g:target", `target-${String(i)}`));
    for (let i = 0; i < 50; i++) log.log("discord", entry("g:noisy", `noisy-${String(i)}`));

    // If it sliced last-30 THEN filtered, the target room's early entries would
    // be gone (0). Filtering first keeps all 3.
    const target = log.getTodayContext("discord", 30, "g:target");
    expect(target.map((e) => e.text)).toEqual(["target-0", "target-1", "target-2"]);
  });
});
