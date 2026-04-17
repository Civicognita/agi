/**
 * UsageStore Tests — Phase 8d
 *
 * Covers the extended UsageStore: record(), routing metadata, escalation
 * tracking, aggregate queries, and migration safety.
 *
 * Uses in-memory SQLite via createDatabase(":memory:"), fresh per test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase } from "./db.js";
import type { Database } from "./db.js";
import { UsageStore } from "./usage-store.js";

describe("UsageStore", () => {
  let db: Database;
  let store: UsageStore;

  beforeEach(() => {
    db = createDatabase(":memory:");
    store = new UsageStore(db);
  });

  describe("record", () => {
    it("records usage and returns a record with cost", () => {
      const rec = store.record({
        entityId: "#E0",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        outputTokens: 200,
        source: "chat",
      });
      expect(rec.id).toBeDefined();
      expect(rec.costUsd).toBeGreaterThan(0);
      expect(rec.provider).toBe("anthropic");
      expect(rec.model).toBe("claude-sonnet-4-6");
    });

    it("records routing metadata", () => {
      const rec = store.record({
        entityId: "#E0",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        inputTokens: 100,
        outputTokens: 50,
        source: "chat",
        costMode: "economy",
        escalated: false,
      });
      expect(rec.id).toBeDefined();
    });

    it("records escalation with original model", () => {
      store.record({
        entityId: "#E0",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        outputTokens: 200,
        source: "chat",
        costMode: "balanced",
        escalated: true,
        originalModel: "claude-haiku-4-5",
      });
      const stats = store.getEscalationRate(30);
      expect(stats.escalated).toBe(1);
    });
  });

  describe("getSummary", () => {
    it("returns aggregate totals", () => {
      store.record({ entityId: "#E0", provider: "anthropic", model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 200 });
      store.record({ entityId: "#E0", provider: "openai", model: "gpt-4o", inputTokens: 500, outputTokens: 100 });
      const summary = store.getSummary(30);
      expect(summary.invocationCount).toBe(2);
      expect(summary.totalInputTokens).toBe(1500);
      expect(summary.totalOutputTokens).toBe(300);
      expect(summary.totalCostUsd).toBeGreaterThan(0);
    });

    it("returns zeros for empty store", () => {
      const summary = store.getSummary(30);
      expect(summary.invocationCount).toBe(0);
      expect(summary.totalCostUsd).toBe(0);
    });
  });

  describe("getByProvider", () => {
    it("groups by provider", () => {
      store.record({ entityId: "#E0", provider: "anthropic", model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 200 });
      store.record({ entityId: "#E0", provider: "openai", model: "gpt-4o", inputTokens: 500, outputTokens: 100 });
      const rows = store.getByProvider(30);
      expect(rows.length).toBe(2);
      expect(rows.find((r) => r.provider === "anthropic")).toBeDefined();
      expect(rows.find((r) => r.provider === "openai")).toBeDefined();
    });
  });

  describe("getByModel", () => {
    it("groups by model", () => {
      store.record({ entityId: "#E0", provider: "anthropic", model: "claude-sonnet-4-6", inputTokens: 500, outputTokens: 100 });
      store.record({ entityId: "#E0", provider: "anthropic", model: "claude-haiku-4-5", inputTokens: 200, outputTokens: 50 });
      const rows = store.getByModel(30);
      expect(rows.length).toBe(2);
    });
  });

  describe("getByCostMode", () => {
    it("groups by cost mode", () => {
      store.record({ entityId: "#E0", provider: "anthropic", model: "claude-haiku-4-5", inputTokens: 100, outputTokens: 50, costMode: "economy" });
      store.record({ entityId: "#E0", provider: "anthropic", model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 200, costMode: "balanced" });
      const rows = store.getByCostMode(30);
      expect(rows.length).toBe(2);
      expect(rows.find((r) => r.costMode === "economy")).toBeDefined();
      expect(rows.find((r) => r.costMode === "balanced")).toBeDefined();
    });
  });

  describe("getEscalationRate", () => {
    it("calculates escalation rate", () => {
      store.record({ entityId: "#E0", provider: "anthropic", model: "claude-haiku-4-5", inputTokens: 100, outputTokens: 50, escalated: false });
      store.record({ entityId: "#E0", provider: "anthropic", model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 200, escalated: true });
      const stats = store.getEscalationRate(30);
      expect(stats.total).toBe(2);
      expect(stats.escalated).toBe(1);
      expect(stats.rate).toBeCloseTo(0.5);
    });

    it("returns 0 rate when empty", () => {
      const stats = store.getEscalationRate(30);
      expect(stats.total).toBe(0);
      expect(stats.rate).toBe(0);
    });
  });

  describe("migration safety", () => {
    it("handles repeated construction", () => {
      const store2 = new UsageStore(db);
      expect(store2).toBeDefined();
    });
  });
});
