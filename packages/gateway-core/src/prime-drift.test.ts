/**
 * Doctrine drift regression tests (s112 t382).
 *
 * Two test modes:
 *
 * 1. Unit mode (default) — tests the framework itself: PrimeReader can
 *    find canonical PRIME entries, AlignmentScorer parses model output
 *    correctly, and the gold-eval fixture is well-formed. No model calls.
 *
 * 2. Live mode (PRIME_DRIFT_CHECK=1) — loads the gold-eval fixture,
 *    calls the active model, and checks must_include / must_not_include
 *    against each response. P0-tagged entries hard-fail; P1/P2 warn.
 *    Requires the test VM + a connected model (aion-micro or cloud).
 *
 * Enable live mode:
 *   PRIME_DRIFT_CHECK=1 agi test prime-drift
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { PrimeReader } from "./prime-reader.js";
import { AlignmentScorer } from "./prime-alignment-scorer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GoldEval {
  id: string;
  tag: "P0" | "P1" | "P2";
  prompt: string;
  must_include?: string[];
  must_not_include?: string[];
  must_score_high_for: string[];
}

function loadGoldEvals(): GoldEval[] {
  const fixturePath = join(import.meta.dirname, "../../../test/fixtures/prime-gold-evals.jsonl");
  if (!existsSync(fixturePath)) return [];
  return readFileSync(fixturePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as GoldEval);
}

function primeDir(): string {
  // Resolve from the gateway-core package back up to the workspace root,
  // then into the PRIME repo. Test VM mounts the full workspace.
  return join(import.meta.dirname, "../../../../../../prime");
}

// ---------------------------------------------------------------------------
// Unit tests — no model calls, always run
// ---------------------------------------------------------------------------

describe("PrimeReader — unit", () => {
  it("initializes without throwing on a missing primeDir", () => {
    const reader = new PrimeReader("/nonexistent/path");
    expect(reader.getVersion()).toBe("unknown");
    expect(reader.listEntries()).toEqual([]);
  });

  it("getEntry returns undefined for a missing id", () => {
    const reader = new PrimeReader("/nonexistent/path");
    expect(reader.getEntry("0SCALE")).toBeUndefined();
  });

  it("resolves the PRIME directory and finds canonical entries", () => {
    const dir = primeDir();
    if (!existsSync(dir)) {
      // PRIME repo not cloned — skip gracefully
      return;
    }
    const reader = new PrimeReader(dir);
    const scale = reader.getEntry("0SCALE");
    expect(scale).toBeDefined();
    expect(scale!.kind).toBe("core");
    expect(scale!.content).toContain("0SCALE");
    expect(scale!.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(scale!.version).toBeTruthy();
  });

  it("getEntry('persona') resolves dotfile .persona.md", () => {
    const dir = primeDir();
    if (!existsSync(dir)) return;
    const reader = new PrimeReader(dir);
    const persona = reader.getEntry("persona");
    expect(persona).toBeDefined();
    expect(persona!.kind).toBe("truth");
    expect(persona!.content.toLowerCase()).toContain("aionima");
  });

  it("listEntries('truth') returns only truth-domain entries", () => {
    const dir = primeDir();
    if (!existsSync(dir)) return;
    const reader = new PrimeReader(dir);
    const truth = reader.listEntries("truth");
    expect(truth.length).toBeGreaterThan(0);
    for (const e of truth) {
      expect(e.kind).toBe("truth");
    }
  });

  it("listEntries('core') returns only core-domain entries", () => {
    const dir = primeDir();
    if (!existsSync(dir)) return;
    const reader = new PrimeReader(dir);
    const core = reader.listEntries("core");
    expect(core.length).toBeGreaterThan(0);
    for (const e of core) {
      expect(e.kind).toBe("core");
    }
  });

  it("all returned entries have valid hash format", () => {
    const dir = primeDir();
    if (!existsSync(dir)) return;
    const reader = new PrimeReader(dir);
    for (const e of reader.listEntries()) {
      expect(e.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });
});

describe("AlignmentScorer — unit (mock invoke)", () => {
  it("parses a valid score from model JSON output", async () => {
    const reader = new PrimeReader("/nonexistent/path");
    const scorer = new AlignmentScorer({
      primeReader: reader,
      invoke: async () => '{"score": 0.85}',
    });
    const record = mockEpisode();
    const score = await scorer.scoreEpisode(record);
    expect(score).toBeCloseTo(0.85);
  });

  it("clamps score to [0, 1]", async () => {
    const reader = new PrimeReader("/nonexistent/path");
    const scorer = new AlignmentScorer({
      primeReader: reader,
      invoke: async () => '{"score": 1.5}',
    });
    expect(await scorer.scoreEpisode(mockEpisode())).toBe(1);
  });

  it("returns 0.5 on malformed model output", async () => {
    const reader = new PrimeReader("/nonexistent/path");
    const scorer = new AlignmentScorer({
      primeReader: reader,
      invoke: async () => "not valid json at all",
    });
    expect(await scorer.scoreEpisode(mockEpisode())).toBe(0.5);
  });

  it("returns 0.5 when invoke rejects", async () => {
    const reader = new PrimeReader("/nonexistent/path");
    const scorer = new AlignmentScorer({
      primeReader: reader,
      invoke: async () => { throw new Error("model offline"); },
    });
    expect(await scorer.scoreEpisode(mockEpisode())).toBe(0.5);
  });

  it("caches score for the same episode hash + prime version", async () => {
    let calls = 0;
    const reader = new PrimeReader("/nonexistent/path");
    const scorer = new AlignmentScorer({
      primeReader: reader,
      invoke: async () => { calls++; return '{"score": 0.9}'; },
    });
    const record = mockEpisode();
    await scorer.scoreEpisode(record);
    await scorer.scoreEpisode(record);
    expect(calls).toBe(1);
  });

  it("clearCache forces a re-invoke", async () => {
    let calls = 0;
    const reader = new PrimeReader("/nonexistent/path");
    const scorer = new AlignmentScorer({
      primeReader: reader,
      invoke: async () => { calls++; return '{"score": 0.7}'; },
    });
    const record = mockEpisode();
    await scorer.scoreEpisode(record);
    scorer.clearCache();
    await scorer.scoreEpisode(record);
    expect(calls).toBe(2);
  });
});

describe("Gold-eval fixture — structure validation", () => {
  it("fixture file exists and is non-empty", () => {
    const evals = loadGoldEvals();
    expect(evals.length).toBeGreaterThan(0);
  });

  it("all entries have required fields", () => {
    for (const e of loadGoldEvals()) {
      expect(e.id).toBeTruthy();
      expect(["P0", "P1", "P2"]).toContain(e.tag);
      expect(typeof e.prompt).toBe("string");
      expect(e.prompt.length).toBeGreaterThan(0);
      expect(Array.isArray(e.must_score_high_for)).toBe(true);
    }
  });

  it("has at least 3 P0-tagged entries", () => {
    const p0 = loadGoldEvals().filter((e) => e.tag === "P0");
    expect(p0.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Live doctrine-drift tests — PRIME_DRIFT_CHECK=1 only
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.PRIME_DRIFT_CHECK)(
  "Doctrine drift — live model check (PRIME_DRIFT_CHECK=1)",
  () => {
    const evals = loadGoldEvals();
    const warnings: string[] = [];
    const failures: string[] = [];

    for (const ge of evals) {
      it(`ge-${ge.id} [${ge.tag}]: "${ge.prompt.slice(0, 60)}"`, async () => {
        // Build a minimal model response for string-match checking.
        // In live mode the actual system under test provides the response
        // via the gateway's chat endpoint; here we document the expected
        // contract so the test serves as the spec.
        //
        // Implementers: wire this to the actual gateway model call once
        // the agent-invoker express path is available in the test harness.
        const modelResponse = await getModelResponse(ge.prompt);

        const missingIncludes = (ge.must_include ?? []).filter(
          (s) => !modelResponse.toLowerCase().includes(s.toLowerCase()),
        );
        const forbiddenPresent = (ge.must_not_include ?? []).filter(
          (s) => modelResponse.toLowerCase().includes(s.toLowerCase()),
        );

        const hasFault = missingIncludes.length > 0 || forbiddenPresent.length > 0;
        if (!hasFault) return;

        const msg = [
          `[${ge.id}] [${ge.tag}] prompt: "${ge.prompt}"`,
          missingIncludes.length > 0 ? `  MISSING: ${missingIncludes.join(", ")}` : "",
          forbiddenPresent.length > 0 ? `  FORBIDDEN present: ${forbiddenPresent.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        if (ge.tag === "P0") {
          failures.push(msg);
          expect.fail(msg);
        } else {
          warnings.push(msg);
          console.warn("[drift-warn]", msg);
        }
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockEpisode() {
  return {
    id: "test-episode-001",
    timestamp: "2026-01-01T00:00:00Z",
    actor: { entityId: "$A0", coaAlias: "$A0" },
    summary: "Aion helped the user configure a new plugin for the Aionima system.",
    tags: ["plugin", "configuration"],
    confidence: 0.8,
    sourceLinks: ["session:abc123"],
    hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    coaFingerprint: "coa:test:001",
  };
}

/** Placeholder for live model invocation. Replace with real gateway call in live mode. */
async function getModelResponse(_prompt: string): Promise<string> {
  // Live drift tests must inject a real invoke function here via the test
  // harness (e.g. agi test --e2e prime-drift). Stub returns empty so unit
  // tests don't accidentally pass due to missing-include checks on empty string.
  return "";
}
