import { describe, expect, test } from "vitest";
import { defineProvider } from "./define-provider.js";

describe("defineProvider", () => {
  test("builds a minimal valid LLMProviderDefinition", () => {
    const def = defineProvider("test", "Test")
      .defaultModel("test-model")
      .envKey("TEST_KEY")
      .factory(() => ({}))
      .build();
    expect(def.id).toBe("test");
    expect(def.name).toBe("Test");
    expect(def.defaultModel).toBe("test-model");
    expect(def.envKey).toBe("TEST_KEY");
    expect(def.requiresApiKey).toBe(true);
  });

  test("throws when defaultModel is missing", () => {
    expect(() =>
      defineProvider("x", "X")
        .envKey("X_KEY")
        .factory(() => ({}))
        .build(),
    ).toThrow(/defaultModel/);
  });

  test("throws when factory is missing", () => {
    expect(() =>
      defineProvider("x", "X")
        .defaultModel("m")
        .envKey("X_KEY")
        .build(),
    ).toThrow(/factory/);
  });

  test("throws when requiresApiKey is true and envKey is missing", () => {
    expect(() =>
      defineProvider("x", "X")
        .defaultModel("m")
        .requiresApiKey(true)
        .factory(() => ({}))
        .build(),
    ).toThrow(/envKey/);
  });

  test("requiresApiKey(false) allows omitting envKey", () => {
    const def = defineProvider("local", "Local")
      .defaultModel("m")
      .requiresApiKey(false)
      .factory(() => ({}))
      .build();
    expect(def.envKey).toBe("");
    expect(def.requiresApiKey).toBe(false);
  });

  // Cycle 129 / cycle 139 — fetchModels SDK contract.
  describe("fetchModels (cycle 129 cloud-provider getModels contract)", () => {
    test("chains via .fetchModels() and exposes the function as .getModels", async () => {
      const fetcher = async () => [
        { id: "model-a", label: "Model A", contextLength: 200_000 },
        { id: "model-b", capabilities: { vision: true, tools: true } },
      ];
      const def = defineProvider("cloud", "Cloud")
        .defaultModel("model-a")
        .envKey("CLOUD_KEY")
        .factory(() => ({}))
        .fetchModels(fetcher)
        .build();

      expect(def.getModels).toBeDefined();
      const models = await def.getModels!({ apiKey: "fake" });
      if (!models) throw new Error("expected non-null model list");
      expect(models).toHaveLength(2);
      const [first, second] = models;
      if (!first || !second) throw new Error("expected two models");
      expect(first.id).toBe("model-a");
      expect(first.contextLength).toBe(200_000);
      expect(second.capabilities?.vision).toBe(true);
    });

    test("getModels is undefined when .fetchModels() is not called", () => {
      const def = defineProvider("static", "Static")
        .defaultModel("m")
        .envKey("X")
        .factory(() => ({}))
        .build();
      expect(def.getModels).toBeUndefined();
    });

    test("getModels returning null is honored as 'unavailable'", async () => {
      const def = defineProvider("offline", "Offline")
        .defaultModel("m")
        .envKey("X")
        .factory(() => ({}))
        .fetchModels(async () => null)
        .build();
      const result = await def.getModels!({});
      expect(result).toBeNull();
    });
  });
});
