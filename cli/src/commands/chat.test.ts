/**
 * `agi chat`'s `.agi` envelope detection — a lightweight, display-only
 * duplicate of gateway-core's `readAgiEnvelopeContext` search (the server
 * does its own detection for actual system-prompt context; this is just
 * the CLI's startup banner). Covers the walk-up + not-an-envelope cases;
 * the full checkpoint.mdc parsing is exercised server-side in
 * `system-prompt-project-instructions.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectAgiEnvelope } from "./chat.js";

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `chat-envelope-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("detectAgiEnvelope", () => {
  it("detects an envelope at the exact path", () => {
    writeFileSync(join(root, "project.json"), "{}");
    mkdirSync(join(root, ".ai"), { recursive: true });
    expect(detectAgiEnvelope(root)).toBe(root);
  });

  it("walks up to find an envelope root from a nested folder", () => {
    writeFileSync(join(root, "project.json"), "{}");
    mkdirSync(join(root, ".ai"), { recursive: true });
    const nested = join(root, "repos", "agi");
    mkdirSync(nested, { recursive: true });
    expect(detectAgiEnvelope(nested)).toBe(root);
  });

  it("returns null when there is no project.json + .ai/ anywhere in range", () => {
    const nested = join(root, "just", "a", "plain", "folder");
    mkdirSync(nested, { recursive: true });
    expect(detectAgiEnvelope(nested)).toBeNull();
  });

  it("returns null when only project.json exists without .ai/", () => {
    writeFileSync(join(root, "project.json"), "{}");
    expect(detectAgiEnvelope(root)).toBeNull();
  });
});
