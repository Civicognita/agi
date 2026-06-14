/**
 * dev-mode-forks tests — coreForkDir layout resolver.
 *
 * Regression guard for the "busted Aionima project page" bug (2026-06-08):
 * after the meta-project restructure (CLAUDE.md § 8, 2026-05-13) forks moved
 * from a flat `_aionima/<slug>/` to `_aionima/repos/<slug>/`, but the merge +
 * contribute helpers still joined `collectionDir + slug`, so every fork read as
 * "not provisioned" and the Repos + Contribute panels rendered empty.
 *
 * coreForkDir is the single source of truth that repairs this. These tests
 * pin its three cases so the path scheme can't silently regress again.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { coreForkDir } from "./dev-mode-forks.js";

let collectionDir: string;

beforeEach(() => {
  collectionDir = mkdtempSync(join(tmpdir(), "agi-forkdir-"));
});

afterEach(() => {
  rmSync(collectionDir, { recursive: true, force: true });
});

describe("coreForkDir", () => {
  it("resolves the nested repos/<slug> layout when it has a .git", () => {
    // Current canonical layout: _aionima/repos/agi/.git
    mkdirSync(join(collectionDir, "repos", "agi", ".git"), { recursive: true });
    expect(coreForkDir(collectionDir, "agi")).toBe(join(collectionDir, "repos", "agi"));
  });

  it("falls back to the legacy flat <slug> layout when only it has a .git", () => {
    // Pre-restructure installs: _aionima/agi/.git
    mkdirSync(join(collectionDir, "agi", ".git"), { recursive: true });
    expect(coreForkDir(collectionDir, "agi")).toBe(join(collectionDir, "agi"));
  });

  it("prefers nested over flat when BOTH exist (post-restructure wins)", () => {
    mkdirSync(join(collectionDir, "repos", "agi", ".git"), { recursive: true });
    mkdirSync(join(collectionDir, "agi", ".git"), { recursive: true });
    expect(coreForkDir(collectionDir, "agi")).toBe(join(collectionDir, "repos", "agi"));
  });

  it("returns the canonical repos/<slug> target when neither exists yet (fresh clone)", () => {
    // A directory that merely exists (no .git) must NOT be treated as a fork.
    mkdirSync(join(collectionDir, "agi"), { recursive: true });
    expect(coreForkDir(collectionDir, "agi")).toBe(join(collectionDir, "repos", "agi"));
  });
});
