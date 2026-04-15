/**
 * MarketplaceStore.syncPlugins — diff computation tests.
 *
 * Validates the `CatalogDiff` return shape so the Plugin Marketplace's
 * "Refresh catalog" button can report what actually changed, rather than the
 * silent "N plugins from source" toast it used to show. Regression guard for
 * the Fancy UI rewrite + 54-plugin bump that went undetected under the
 * original count-only API.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarketplaceStore } from "./store.js";
import type { MarketplacePluginEntry } from "./types.js";

function plugin(name: string, version: string): MarketplacePluginEntry {
  return { name, version, source: `./plugins/${name}` };
}

describe("syncPlugins — diff", () => {
  let tmpDir: string;
  let store: MarketplaceStore;
  let sourceId: number;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mp-diff-"));
    store = new MarketplaceStore(join(tmpDir, "mp.db"));
    sourceId = store.addSource("owner/repo", "github", "Test", "ref").id;
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("first sync against an empty source reports every plugin as added", () => {
    const diff = store.syncPlugins(sourceId, [plugin("a", "0.1.0"), plugin("b", "0.1.0")]);
    expect(diff.added.sort()).toEqual(["a", "b"]);
    expect(diff.updated).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.total).toBe(2);
  });

  it("second sync with no changes reports empty diff + stable total", () => {
    store.syncPlugins(sourceId, [plugin("a", "0.1.0"), plugin("b", "0.1.0")]);
    const diff = store.syncPlugins(sourceId, [plugin("a", "0.1.0"), plugin("b", "0.1.0")]);
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.total).toBe(2);
  });

  it("version bump on an existing plugin surfaces as an update with from/to", () => {
    store.syncPlugins(sourceId, [plugin("a", "0.1.0"), plugin("b", "0.1.0")]);
    const diff = store.syncPlugins(sourceId, [plugin("a", "0.1.0"), plugin("b", "0.2.0")]);
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([{ name: "b", from: "0.1.0", to: "0.2.0" }]);
    expect(diff.removed).toEqual([]);
  });

  it("new plugin + removed plugin appear in their respective buckets", () => {
    store.syncPlugins(sourceId, [plugin("a", "0.1.0"), plugin("b", "0.1.0")]);
    const diff = store.syncPlugins(sourceId, [plugin("a", "0.1.0"), plugin("c", "0.1.0")]);
    expect(diff.added).toEqual(["c"]);
    expect(diff.removed).toEqual(["b"]);
    expect(diff.updated).toEqual([]);
  });

  it("mixed change set: added, updated, and removed all in one sync", () => {
    store.syncPlugins(sourceId, [plugin("keep", "0.1.0"), plugin("bump", "0.1.0"), plugin("gone", "0.1.0")]);
    const diff = store.syncPlugins(sourceId, [plugin("keep", "0.1.0"), plugin("bump", "0.2.0"), plugin("new", "0.1.0")]);
    expect(diff.added).toEqual(["new"]);
    expect(diff.updated).toEqual([{ name: "bump", from: "0.1.0", to: "0.2.0" }]);
    expect(diff.removed).toEqual(["gone"]);
    expect(diff.total).toBe(3);
  });

  it("plugins without a version field are diffed as empty-string version (no phantom updates)", () => {
    store.syncPlugins(sourceId, [{ name: "a", source: "./a" }]);
    const diff = store.syncPlugins(sourceId, [{ name: "a", source: "./a" }]);
    expect(diff.updated).toEqual([]);
  });
});
