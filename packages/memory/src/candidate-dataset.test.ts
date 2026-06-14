import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { gateDataQuality, gateReward, gateGovernance, gateRollback } from "./gates/index.js";
import { CandidateDatasetAccumulator } from "./candidate-dataset.js";
import type { EpisodicRecord } from "./episodic.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  return {
    id: "01k000000000000000000000ab",
    timestamp: "2026-01-01T00:00:00Z",
    actor: { entityId: "$A0", coaAlias: "$A0" },
    summary: "Aion helped the user configure a Discord integration successfully.",
    tags: ["configuration", "discord"],
    confidence: 0.85,
    primeAlignment: 0.92,
    sourceLinks: ["session:test"],
    hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    coaFingerprint: "coa:test:001",
    modelVersion: "qwen2.5:0.5b",
    ...overrides,
  };
}

async function loadFixtureLines(filename: string): Promise<Record<string, unknown>[]> {
  const path = join(__dirname, "../../../test/fixtures/eval-sets", filename);
  const lines: Record<string, unknown>[] = [];
  const rl = createInterface({ input: createReadStream(path) });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) lines.push(JSON.parse(trimmed) as Record<string, unknown>);
  }
  return lines;
}

function toRecord(row: Record<string, unknown>): EpisodicRecord {
  return row as unknown as EpisodicRecord;
}

// ---------------------------------------------------------------------------
// Gate 1 — Data quality
// ---------------------------------------------------------------------------

describe("gateDataQuality (s112 t385 G1)", () => {
  it("passes a well-formed record", () => {
    expect(gateDataQuality(makeRecord(), [])).toMatchObject({ pass: true });
  });

  it("rejects empty summary", () => {
    const r = gateDataQuality(makeRecord({ summary: "" }), []);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/coherence/i);
  });

  it("rejects summary that is only whitespace", () => {
    const r = gateDataQuality(makeRecord({ summary: "   " }), []);
    expect(r.pass).toBe(false);
  });

  it("rejects summary containing error tokens", () => {
    const r = gateDataQuality(
      makeRecord({ summary: "Traceback: TypeError: Cannot read properties of undefined" }),
      [],
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/error token/i);
  });

  it("rejects low primeAlignment", () => {
    const r = gateDataQuality(makeRecord({ primeAlignment: 0.2 }), []);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/primeAlignment/i);
  });

  it("passes when primeAlignment is absent (field is optional)", () => {
    const record = makeRecord();
    delete (record as Partial<EpisodicRecord>).primeAlignment;
    expect(gateDataQuality(record, [])).toMatchObject({ pass: true });
  });

  it("rejects a hash seen before (novelty check)", () => {
    const hash = "sha256:abcdef";
    const seenHashes = [hash];
    const r = gateDataQuality(makeRecord({ hash }), seenHashes);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/novelty/i);
  });

  it("passes when the hash is new", () => {
    expect(
      gateDataQuality(makeRecord({ hash: "sha256:unique-hash" }), ["sha256:other"]),
    ).toMatchObject({ pass: true });
  });

  // Fixture-driven: every fail line must reject with the named reason category
  it("rejects all data-quality-fail.jsonl fixtures", async () => {
    const lines = await loadFixtureLines("data-quality-fail.jsonl");
    const seenHashes: string[] = [];
    for (const row of lines) {
      const record = toRecord(row);
      const expectReject = String(row["expect_reject"] ?? "");
      // For novelty tests: pre-seed the hash so it appears as a duplicate
      if (expectReject.includes("novelty")) {
        seenHashes.push(record.hash);
      }
      const result = gateDataQuality(record, seenHashes);
      expect(result.pass, `${String(row["id"])}: expected rejection (${expectReject})`).toBe(false);
    }
  });

  // Fixture-driven: every pass line must pass
  it("passes all data-quality-pass.jsonl fixtures", async () => {
    const lines = await loadFixtureLines("data-quality-pass.jsonl");
    const seenHashes: string[] = [];
    for (const row of lines) {
      const record = toRecord(row);
      const result = gateDataQuality(record, seenHashes);
      expect(result.pass, `${String(row["id"])}: expected pass`).toBe(true);
      seenHashes.push(record.hash);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate 2 — Reward (stub)
// ---------------------------------------------------------------------------

describe("gateReward (s112 t385 G2 — stub)", () => {
  it("always passes with not_yet_wired reason", () => {
    const r = gateReward(makeRecord());
    expect(r.pass).toBe(true);
    expect(r.reason).toBe("not_yet_wired");
  });
});

// ---------------------------------------------------------------------------
// Gate 3 — Governance (stub)
// ---------------------------------------------------------------------------

describe("gateGovernance (s112 t385 G3 — stub)", () => {
  it("always passes with not_yet_wired reason", () => {
    const r = gateGovernance(makeRecord());
    expect(r.pass).toBe(true);
    expect(r.reason).toBe("not_yet_wired");
  });
});

// ---------------------------------------------------------------------------
// Gate 4 — Rollback integrity
// ---------------------------------------------------------------------------

describe("gateRollback (s112 t385 G4)", () => {
  it("passes a valid record", () => {
    expect(gateRollback(makeRecord())).toMatchObject({ pass: true });
  });

  it("rejects hash that does not start with sha256:", () => {
    const r = gateRollback(makeRecord({ hash: "md5:abc" }));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/hash/i);
  });

  it("rejects empty coaFingerprint", () => {
    const r = gateRollback(makeRecord({ coaFingerprint: "" }));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/coaFingerprint/i);
  });
});

// ---------------------------------------------------------------------------
// CandidateDatasetAccumulator
// ---------------------------------------------------------------------------

describe("CandidateDatasetAccumulator (s112 t385)", () => {
  it("admits a qualifying record", () => {
    const acc = new CandidateDatasetAccumulator();
    const result = acc.accumulate(makeRecord());
    expect(result.admitted).toBe(true);
    expect(result.gates.dataQuality.pass).toBe(true);
    expect(result.gates.rollback.pass).toBe(true);
  });

  it("rejects a record below confidence threshold", () => {
    const acc = new CandidateDatasetAccumulator({ confidenceThreshold: 0.9 });
    const result = acc.accumulate(makeRecord({ confidence: 0.5 }));
    expect(result.admitted).toBe(false);
  });

  it("rejects a duplicate hash on second accumulate", () => {
    const acc = new CandidateDatasetAccumulator();
    const record = makeRecord();
    acc.accumulate(record);
    const second = acc.accumulate(record);
    expect(second.admitted).toBe(false);
    expect(second.gates.dataQuality.pass).toBe(false);
  });

  it("admitted result includes a CandidateEntry", () => {
    const acc = new CandidateDatasetAccumulator();
    const result = acc.accumulate(makeRecord());
    expect(result.entry).toBeDefined();
    expect(result.entry?.episode_id).toBeDefined();
    expect(result.entry?.summary).toBe(makeRecord().summary);
  });

  it("CandidateEntry carries all required fields", () => {
    const acc = new CandidateDatasetAccumulator();
    const record = makeRecord();
    const { entry } = acc.accumulate(record);
    expect(entry).toMatchObject({
      episode_id: record.id,
      summary: record.summary,
      tags: record.tags,
      confidence: record.confidence,
      hash: record.hash,
      provenance: { coa_fingerprint: record.coaFingerprint },
    });
  });
});
