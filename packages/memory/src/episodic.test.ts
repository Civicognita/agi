import { describe, expect, it } from "vitest";
import {
  canonicalEpisodicHash,
  episodicToAnchor,
  type EpisodicRecord,
} from "./episodic.js";

function makeRecord(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  return {
    id: "01k000000000000000000000ab",
    timestamp: "2026-04-25T22:00:00.000Z",
    actor: { entityId: "ent_e0", coaAlias: "#E0" },
    summary: "Owner asked Aion to summarize the impactivism whitepaper.",
    tags: ["chat", "knowledge"],
    confidence: 0.82,
    sourceLinks: ["chat-session:abc123"],
    hash: "sha256:placeholder",
    coaFingerprint: "#E0.#O0.$A0.SUMMARIZE()<>$REG-1",
    ...overrides,
  };
}

describe("canonicalEpisodicHash — determinism + content sensitivity (s112 t381)", () => {
  it("returns a sha256: prefixed hex string", () => {
    const h = canonicalEpisodicHash(makeRecord());
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic — same record hashes the same", () => {
    const h1 = canonicalEpisodicHash(makeRecord());
    const h2 = canonicalEpisodicHash(makeRecord());
    expect(h1).toBe(h2);
  });

  it("is insensitive to tag order (canonical sort)", () => {
    const h1 = canonicalEpisodicHash(makeRecord({ tags: ["a", "b", "c"] }));
    const h2 = canonicalEpisodicHash(makeRecord({ tags: ["c", "a", "b"] }));
    expect(h1).toBe(h2);
  });

  it("is insensitive to sourceLink order", () => {
    const h1 = canonicalEpisodicHash(makeRecord({ sourceLinks: ["x", "y", "z"] }));
    const h2 = canonicalEpisodicHash(makeRecord({ sourceLinks: ["z", "x", "y"] }));
    expect(h1).toBe(h2);
  });

  it("changes when summary changes", () => {
    const h1 = canonicalEpisodicHash(makeRecord({ summary: "first" }));
    const h2 = canonicalEpisodicHash(makeRecord({ summary: "second" }));
    expect(h1).not.toBe(h2);
  });

  it("changes when actor changes", () => {
    const h1 = canonicalEpisodicHash(makeRecord({ actor: { entityId: "e0", coaAlias: "#E0" } }));
    const h2 = canonicalEpisodicHash(makeRecord({ actor: { entityId: "e1", coaAlias: "#E1" } }));
    expect(h1).not.toBe(h2);
  });

  it("changes when timestamp changes", () => {
    const h1 = canonicalEpisodicHash(makeRecord({ timestamp: "2026-04-25T00:00:00.000Z" }));
    const h2 = canonicalEpisodicHash(makeRecord({ timestamp: "2026-04-26T00:00:00.000Z" }));
    expect(h1).not.toBe(h2);
  });

  it("ignores ephemeral fields (confidence, primeAlignment, embedding)", () => {
    const baseline = makeRecord();
    const rescored = makeRecord({
      confidence: 0.99,
      primeAlignment: 0.91,
      embedding: [0.1, 0.2, 0.3],
    });
    expect(canonicalEpisodicHash(baseline)).toBe(canonicalEpisodicHash(rescored));
  });

  it("ignores the `hash` field itself (no self-reference loop)", () => {
    const a = makeRecord({ hash: "sha256:aaa" });
    const b = makeRecord({ hash: "sha256:bbb" });
    expect(canonicalEpisodicHash(a)).toBe(canonicalEpisodicHash(b));
  });

  it("treats undefined and absent modelVersion identically", () => {
    const a = makeRecord({ modelVersion: undefined });
    const b = makeRecord();
    delete (b as Partial<EpisodicRecord>).modelVersion;
    expect(canonicalEpisodicHash(a)).toBe(canonicalEpisodicHash(b));
  });
});

describe("episodicToAnchor — bridge from Layer B → Layer D (s112 t381 + t383)", () => {
  it("uses the episodic record's hash as the anchor identity", () => {
    const record = makeRecord({ hash: "sha256:my-event-id" });
    const anchor = episodicToAnchor(record);
    expect(anchor.hash).toBe("sha256:my-event-id");
  });

  it("carries owner from the actor's entityId", () => {
    const record = makeRecord({ actor: { entityId: "ent_e7", coaAlias: "#E7" } });
    const anchor = episodicToAnchor(record);
    expect(anchor.owner).toBe("ent_e7");
  });

  it("carries timestamp through unchanged", () => {
    const record = makeRecord({ timestamp: "2026-04-25T23:45:00.000Z" });
    const anchor = episodicToAnchor(record);
    expect(anchor.timestamp).toBe("2026-04-25T23:45:00.000Z");
  });

  it("declares episodic-memory as the provenance source", () => {
    const record = makeRecord();
    const anchor = episodicToAnchor(record);
    expect(anchor.provenance.source).toBe("episodic-memory");
  });

  it("threads modelVersion into provenance when set", () => {
    const record = makeRecord({ modelVersion: "qwen2.5:7b-instruct" });
    const anchor = episodicToAnchor(record);
    expect(anchor.provenance.modelVersion).toBe("qwen2.5:7b-instruct");
  });

  it("uses confidence as the eval score (gate-relevant signal)", () => {
    const record = makeRecord({ confidence: 0.91 });
    const anchor = episodicToAnchor(record);
    expect(anchor.evalScore).toBe(0.91);
  });
});
