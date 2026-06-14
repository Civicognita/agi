import { describe, expect, it, vi } from "vitest";
import { EpisodeExtractor } from "./episode-extractor.js";
import type { EpisodeExtractorOptions, ExtractionInput } from "./episode-extractor.js";
import type { LLMProvider } from "./llm/index.js";
import type { CandidateDatasetAccumulator } from "@agi/memory";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXTRACT_RESPONSE = JSON.stringify({
  summary: "Aion helped the user configure a Discord integration.",
  decisions: ["Use allowedRoleIds for role gating"],
  preferences: [],
  facts: ["Bot connected to guild successfully"],
  tags: ["configuration", "discord"],
});

const SCORE_RESPONSE = JSON.stringify({
  useful: 0.9,
  aligned: 0.95,
  correct: 0.85,
});

function makeProvider(
  extractResponse = EXTRACT_RESPONSE,
  scoreResponse = SCORE_RESPONSE,
): LLMProvider {
  let callCount = 0;
  return {
    summarize: vi.fn(async () => {
      callCount += 1;
      return callCount === 1 ? extractResponse : scoreResponse;
    }),
  } as unknown as LLMProvider;
}

function makeInput(overrides: Partial<ExtractionInput> = {}): ExtractionInput {
  return {
    userMessage: "How do I configure the Discord bot?",
    assistantResponse: "You can set allowedRoleIds in the Discord channel config.",
    toolsUsed: [],
    model: "qwen2.5:0.5b",
    coaFingerprint: "coa:test:001",
    sessionKey: "session:test-001",
    ...overrides,
  };
}

function makeExtractor(overrides: Partial<EpisodeExtractorOptions> = {}): EpisodeExtractor {
  return new EpisodeExtractor({
    provider: makeProvider(),
    memoryAdapter: { store: vi.fn().mockResolvedValue(undefined) },
    entityId: "$A0",
    coaAlias: "$A0",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

describe("EpisodeExtractor (s112 t384)", () => {
  it("returns an EpisodicRecord on a well-formed exchange", async () => {
    const stored: unknown[] = [];
    const extractor = makeExtractor({
      memoryAdapter: { store: vi.fn(async (r) => { stored.push(r); }) },
    });

    const record = await extractor.extractAndStore(makeInput());

    expect(record).not.toBeNull();
    expect(record?.summary).toBe("Aion helped the user configure a Discord integration.");
    expect(record?.tags).toContain("discord");
    expect(record?.confidence).toBeGreaterThan(0);
    expect(record?.confidence).toBeLessThanOrEqual(1);
  });

  it("stores the record in the memory adapter", async () => {
    const storeFn = vi.fn().mockResolvedValue(undefined);
    const extractor = makeExtractor({
      memoryAdapter: { store: storeFn },
    });

    await extractor.extractAndStore(makeInput());

    expect(storeFn).toHaveBeenCalledOnce();
    const stored = storeFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof stored["hash"]).toBe("string");
    expect(String(stored["hash"])).toMatch(/^sha256:/);
  });

  it("returns null when provider returns empty summary", async () => {
    const provider = makeProvider(
      JSON.stringify({ summary: "", tags: [] }),
      SCORE_RESPONSE,
    );
    const extractor = makeExtractor({ provider });
    const result = await extractor.extractAndStore(makeInput());
    expect(result).toBeNull();
  });

  it("returns null when provider returns non-JSON", async () => {
    const provider = makeProvider("This is not JSON", SCORE_RESPONSE);
    const extractor = makeExtractor({ provider });
    const result = await extractor.extractAndStore(makeInput());
    expect(result).toBeNull();
  });

  it("sets hash with sha256: prefix", async () => {
    const extractor = makeExtractor();
    const record = await extractor.extractAndStore(makeInput());
    expect(record?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("sets actor from entityId and coaAlias options", async () => {
    const extractor = makeExtractor({ entityId: "$A1", coaAlias: "$A1" });
    const record = await extractor.extractAndStore(makeInput());
    expect(record?.actor.entityId).toBe("$A1");
    expect(record?.actor.coaAlias).toBe("$A1");
  });

  it("threads coaFingerprint and model into the record", async () => {
    const extractor = makeExtractor();
    const record = await extractor.extractAndStore(
      makeInput({ coaFingerprint: "coa:fp:999", model: "llama3.2:3b" }),
    );
    expect(record?.coaFingerprint).toBe("coa:fp:999");
    expect(record?.modelVersion).toBe("llama3.2:3b");
  });

  it("confidence is mean of useful/aligned/correct scores", async () => {
    // useful=0.9, aligned=0.95, correct=0.85 → mean=0.9
    const extractor = makeExtractor();
    const record = await extractor.extractAndStore(makeInput());
    expect(record?.confidence).toBeCloseTo(0.9, 2);
  });

  it("falls back to default confidence when score call fails", async () => {
    const provider: LLMProvider = {
      summarize: vi.fn()
        .mockResolvedValueOnce(EXTRACT_RESPONSE) // extract succeeds
        .mockRejectedValueOnce(new Error("timeout")), // score fails
    } as unknown as LLMProvider;
    const extractor = makeExtractor({ provider });
    const record = await extractor.extractAndStore(makeInput());
    // Default score = {useful:0.5, aligned:0.8, correct:0.8} → mean=0.7
    expect(record?.confidence).toBeCloseTo(0.7, 2);
  });
});

// ---------------------------------------------------------------------------
// Accumulator integration
// ---------------------------------------------------------------------------

describe("EpisodeExtractor — accumulator wiring (s112 end-to-end)", () => {
  it("calls accumulator.accumulate with the stored record", async () => {
    const accumulateFn = vi.fn().mockReturnValue({
      admitted: true,
      gates: {
        dataQuality: { pass: true },
        reward: { pass: true },
        governance: { pass: true },
        rollback: { pass: true },
      },
    });
    const accumulator = { accumulate: accumulateFn } as unknown as CandidateDatasetAccumulator;
    const extractor = makeExtractor({ accumulator });

    const record = await extractor.extractAndStore(makeInput());

    expect(accumulateFn).toHaveBeenCalledOnce();
    expect(accumulateFn.mock.calls[0]![0]).toEqual(record);
  });

  it("does not throw when accumulator.accumulate throws", async () => {
    const accumulator = {
      accumulate: vi.fn().mockImplementation(() => { throw new Error("disk full"); }),
    } as unknown as CandidateDatasetAccumulator;
    const extractor = makeExtractor({ accumulator });

    await expect(extractor.extractAndStore(makeInput())).resolves.not.toThrow();
  });

  it("does not call accumulator when extraction returns null", async () => {
    const accumulateFn = vi.fn();
    const accumulator = { accumulate: accumulateFn } as unknown as CandidateDatasetAccumulator;
    const provider = makeProvider(JSON.stringify({ summary: "", tags: [] }), SCORE_RESPONSE);
    const extractor = makeExtractor({ provider, accumulator });

    await extractor.extractAndStore(makeInput());

    expect(accumulateFn).not.toHaveBeenCalled();
  });
});
