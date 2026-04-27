/**
 * PM provider resolution regression — s118 t434.
 *
 * The plugin registry stores PmProviderDefinition records keyed by id;
 * the server.ts resolution logic dispatches on `config.agent.pm.provider`
 * (built-in: "tynn", "tynn-lite"; anything else → registry lookup).
 *
 * This test covers the registry layer + the reserved-id discipline. The
 * end-to-end resolution-from-config path runs at server boot and is
 * verified by the test-VM's startup-smoke test (t407 / s101) — adding
 * an isolated test of the full server resolution path here would require
 * standing up the entire createGatewayRuntimeState dependency graph.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { PluginRegistry } from "@agi/plugins";
import type { PmProviderDefinition } from "@agi/plugins";

function makeMockDef(id: string, name: string): PmProviderDefinition {
  return {
    id,
    name,
    factory: () => ({ providerId: id }),
  };
}

describe("PluginRegistry — PM provider storage (s118 t434)", () => {
  let registry: PluginRegistry;
  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it("addPmProvider stores the definition keyed by id", () => {
    registry.addPmProvider("plugin-a", makeMockDef("linear", "Linear"));
    const got = registry.getPmProvider("linear");
    expect(got?.id).toBe("linear");
    expect(got?.name).toBe("Linear");
  });

  it("getPmProviders returns all registered definitions", () => {
    registry.addPmProvider("plugin-a", makeMockDef("linear", "Linear"));
    registry.addPmProvider("plugin-b", makeMockDef("jira", "Jira"));
    const all = registry.getPmProviders();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.provider.id).sort()).toEqual(["jira", "linear"]);
    expect(all.find((p) => p.provider.id === "linear")?.pluginId).toBe("plugin-a");
  });

  it("getPmProvider returns undefined for unknown id", () => {
    expect(registry.getPmProvider("nonexistent")).toBeUndefined();
  });

  it("addPmProvider deduplicates by id (first-registered wins)", () => {
    registry.addPmProvider("plugin-a", { ...makeMockDef("linear", "Linear A") });
    registry.addPmProvider("plugin-b", { ...makeMockDef("linear", "Linear B") });
    expect(registry.getPmProviders()).toHaveLength(1);
    expect(registry.getPmProvider("linear")?.name).toBe("Linear A");
  });

  it("addPmProvider throws when registering a reserved built-in id (tynn)", () => {
    expect(() => registry.addPmProvider("plugin-a", makeMockDef("tynn", "Plugin Tynn"))).toThrow(/reserved/);
  });

  it("addPmProvider throws when registering a reserved built-in id (tynn-lite)", () => {
    expect(() => registry.addPmProvider("plugin-a", makeMockDef("tynn-lite", "Plugin Tynn Lite"))).toThrow(/reserved/);
  });

  it("registered factory can be invoked and returns the implementation", () => {
    registry.addPmProvider("plugin-a", makeMockDef("linear", "Linear"));
    const def = registry.getPmProvider("linear");
    expect(def).toBeDefined();
    const instance = def!.factory({}) as { providerId: string };
    expect(instance.providerId).toBe("linear");
  });

  it("factory receives the config object as-is (no schema enforcement at registry layer)", () => {
    let received: Record<string, unknown> | null = null;
    const def: PmProviderDefinition = {
      id: "captures-config",
      name: "Captures Config",
      factory: (config) => {
        received = config;
        return { providerId: "captures-config" };
      },
    };
    registry.addPmProvider("plugin-a", def);
    const looked = registry.getPmProvider("captures-config");
    looked!.factory({ apiKey: "k", teamId: "t" });
    expect(received).toEqual({ apiKey: "k", teamId: "t" });
  });

  it("getPluginProvides labels a plugin that registered a PM provider as 'pm-providers'", () => {
    registry.addPmProvider("plugin-a", makeMockDef("linear", "Linear"));
    const labels = registry.getPluginProvides("plugin-a");
    expect(labels).toContain("pm-providers");
  });
});
