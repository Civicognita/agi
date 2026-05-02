import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildMAppContainerArgsPure,
  generateMAppDesktopHtml,
  generateMAppPlaceholderHtml,
  resolveMAppHostDir,
  resolveMAppTiles,
  writeMAppDesktopHtml,
  writePerMAppStandaloneHtml,
  type MAppTile,
} from "./hosting-manager-mapp.js";

const TILE_INSTALLED: MAppTile = {
  id: "budget-tracker",
  name: "Budget Tracker",
  description: "Manage civic budgets at a glance.",
  icon: "💰",
  installed: true,
};

const TILE_PLACEHOLDER: MAppTile = {
  id: "future-app",
  name: "future-app",
  description: "Not installed in MApp Marketplace yet.",
  icon: "📦",
  installed: false,
};

describe("buildMAppContainerArgsPure (s145 t586)", () => {
  it("returns nginx:alpine + read-only HTML mount + project labels", () => {
    const result = buildMAppContainerArgsPure({
      hostname: "ops",
      projectPath: "/home/owner/projects/ops",
      containerName: "agi-ops",
      mappIds: ["budget"],
      hostHtmlDir: "/var/agi/mapps/host/ops",
      networkName: "agi-net-ops",
    });
    expect(result.image).toBe("nginx:alpine");
    expect(result.args).toContain("run");
    expect(result.args).toContain("nginx:alpine");
    expect(result.args).toContain("--name");
    expect(result.args).toContain("agi-ops");
    expect(result.args).toContain("--label");
    expect(result.args).toContain("agi.container-kind=mapp");
    // Bind mount: read-only at the nginx web root
    expect(result.args).toContain("-v");
    expect(result.args).toContain("/var/agi/mapps/host/ops:/usr/share/nginx/html:ro,Z");
    // Network is the per-project podman network
    expect(result.args.some((a) => a === "--network=agi-net-ops")).toBe(true);
  });

  it("injects HOSTNAME_ALLOWED_ORIGIN when tunnelOrigin is provided", () => {
    const result = buildMAppContainerArgsPure({
      hostname: "ops",
      projectPath: "/p/ops",
      containerName: "agi-ops",
      mappIds: [],
      hostHtmlDir: "/h",
      networkName: "agi-net-ops",
      tunnelOrigin: "ops.example.com",
    });
    const envIdx = result.args.indexOf("HOSTNAME_ALLOWED_ORIGIN=ops.example.com");
    expect(envIdx).toBeGreaterThan(-1);
    expect(result.args[envIdx - 1]).toBe("-e");
  });

  it("respects an image override", () => {
    const result = buildMAppContainerArgsPure({
      hostname: "ops",
      projectPath: "/p/ops",
      containerName: "agi-ops",
      mappIds: [],
      hostHtmlDir: "/h",
      networkName: "agi-net-ops",
      image: "caddy:2-alpine",
    });
    expect(result.image).toBe("caddy:2-alpine");
    expect(result.args).toContain("caddy:2-alpine");
  });
});

describe("generateMAppDesktopHtml (s145 t586)", () => {
  it("renders a tile per installed MApp with name + description", () => {
    const html = generateMAppDesktopHtml({ hostname: "ops", tiles: [TILE_INSTALLED] });
    expect(html).toContain("MApps — ops");
    expect(html).toContain("Budget Tracker");
    expect(html).toContain("Manage civic budgets");
    expect(html).toContain('href="/budget-tracker/"');
    expect(html).toContain("tile--installed");
  });

  it("renders placeholder tiles for uninstalled MApps with a 'Not installed' badge", () => {
    const html = generateMAppDesktopHtml({ hostname: "ops", tiles: [TILE_PLACEHOLDER] });
    expect(html).toContain("future-app");
    expect(html).toContain("Not installed yet");
    expect(html).toContain("tile--placeholder");
  });

  it("shows an empty state when no MApps are configured", () => {
    const html = generateMAppDesktopHtml({ hostname: "ops", tiles: [] });
    expect(html).toContain("No MApps configured yet");
    expect(html).toContain("0 MApps configured");
  });

  it("escapes HTML special characters in the hostname + tile fields (XSS guard)", () => {
    const html = generateMAppDesktopHtml({
      hostname: "ops<script>",
      tiles: [{
        id: "evil",
        name: "<img src=x onerror=alert(1)>",
        description: "Mark & sweep",
        icon: "💀",
        installed: true,
      }],
    });
    // No unescaped tag-opener can reach the DOM as markup. The literal
    // string "onerror=alert" is allowed inside an HTML-encoded body
    // (browsers see &lt;img ...&gt; as text, not a tag) — the security
    // property is "no raw <" between user content, not "no banned words."
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    // Escaped equivalents are present
    expect(html).toContain("ops&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Mark &amp; sweep");
  });

  it("singular vs plural MApp count", () => {
    expect(generateMAppDesktopHtml({ hostname: "ops", tiles: [TILE_INSTALLED] }))
      .toContain("1 MApp configured");
    expect(generateMAppDesktopHtml({ hostname: "ops", tiles: [TILE_INSTALLED, TILE_PLACEHOLDER] }))
      .toContain("2 MApps configured");
  });
});

describe("resolveMAppTiles (s145 t586)", () => {
  let cacheRoot: string;

  beforeEach(() => {
    cacheRoot = join(tmpdir(), `mapp-cache-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
    mkdirSync(cacheRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  function writeManifest(id: string, manifest: object): void {
    const dir = join(cacheRoot, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest), "utf-8");
  }

  it("reads installed MApp manifests + populates tile fields", () => {
    writeManifest("budget", { name: "Budget", description: "Track money", icon: "💰" });
    const tiles = resolveMAppTiles(["budget"], cacheRoot);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      id: "budget",
      name: "Budget",
      description: "Track money",
      icon: "💰",
      installed: true,
    });
  });

  it("falls back to placeholder for uninstalled MApp IDs", () => {
    const tiles = resolveMAppTiles(["never-installed"], cacheRoot);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      id: "never-installed",
      name: "never-installed",
      description: "Not installed in MApp Marketplace yet.",
      icon: "📦",
      installed: false,
    });
  });

  it("falls back gracefully when manifest is unparseable", () => {
    const dir = join(cacheRoot, "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), "{ not valid json", "utf-8");
    const tiles = resolveMAppTiles(["broken"], cacheRoot);
    expect(tiles[0]).toMatchObject({
      id: "broken",
      installed: false,
      icon: "⚠️",
    });
  });

  it("uses sane defaults when manifest fields are missing", () => {
    writeManifest("minimal", {}); // empty object
    const tiles = resolveMAppTiles(["minimal"], cacheRoot);
    expect(tiles[0]).toMatchObject({
      id: "minimal",
      name: "minimal",
      description: "(no description)",
      icon: "📦",
      installed: true,
    });
  });

  it("returns one tile per ID, preserving order", () => {
    writeManifest("a", { name: "A" });
    writeManifest("b", { name: "B" });
    const tiles = resolveMAppTiles(["b", "a", "missing"], cacheRoot);
    expect(tiles.map((t) => t.id)).toEqual(["b", "a", "missing"]);
  });
});

describe("resolveMAppHostDir + writeMAppDesktopHtml (s145 t586)", () => {
  let hostRoot: string;

  beforeEach(() => {
    hostRoot = join(tmpdir(), `mapp-host-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  });

  afterEach(() => {
    rmSync(hostRoot, { recursive: true, force: true });
  });

  it("resolveMAppHostDir returns root/hostname", () => {
    const dir = resolveMAppHostDir("ops", hostRoot);
    expect(dir).toBe(join(hostRoot, "ops"));
  });

  it("writeMAppDesktopHtml creates the dir + writes index.html", () => {
    const dir = resolveMAppHostDir("ops", hostRoot);
    writeMAppDesktopHtml(dir, "<!DOCTYPE html><html><body>hi</body></html>");
    const path = join(dir, "index.html");
    const fs = require("node:fs");
    expect(fs.existsSync(path)).toBe(true);
    expect(fs.readFileSync(path, "utf-8")).toContain("hi");
  });

  it("writeMAppDesktopHtml is idempotent — subsequent writes overwrite cleanly", () => {
    const dir = resolveMAppHostDir("ops", hostRoot);
    writeMAppDesktopHtml(dir, "v1");
    writeMAppDesktopHtml(dir, "v2");
    const fs = require("node:fs");
    expect(fs.readFileSync(join(dir, "index.html"), "utf-8")).toBe("v2");
  });
});

describe("generateMAppPlaceholderHtml (s145 t589)", () => {
  it("renders a not-installed page with the MApp id + hostname", () => {
    const html = generateMAppPlaceholderHtml({ mappId: "budget-tracker", hostname: "ops" });
    expect(html).toContain("Not installed yet");
    expect(html).toContain("budget-tracker");
    expect(html).toContain("ops");
    expect(html).toContain('href="/"');
  });

  it("escapes HTML special characters in mappId + hostname (XSS guard)", () => {
    const html = generateMAppPlaceholderHtml({
      mappId: "<script>",
      hostname: "ops<img src=x>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("ops&lt;img src=x&gt;");
  });
});

describe("writePerMAppStandaloneHtml (s145 t589)", () => {
  let hostDir: string;

  beforeEach(() => {
    hostDir = join(tmpdir(), `mapp-standalone-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`, "ops");
  });

  afterEach(() => {
    const root = join(hostDir, "..");
    rmSync(root, { recursive: true, force: true });
  });

  it("writes one /<id>/index.html per uninstalled tile", () => {
    const tiles: MAppTile[] = [
      { id: "alpha", name: "A", description: "", icon: "📦", installed: false },
      { id: "beta", name: "B", description: "", icon: "📦", installed: false },
    ];
    const written = writePerMAppStandaloneHtml(hostDir, tiles);
    expect(written).toEqual(["alpha", "beta"]);
    const fs = require("node:fs");
    expect(fs.existsSync(join(hostDir, "alpha", "index.html"))).toBe(true);
    expect(fs.existsSync(join(hostDir, "beta", "index.html"))).toBe(true);
    expect(fs.readFileSync(join(hostDir, "alpha", "index.html"), "utf-8")).toContain("alpha");
    expect(fs.readFileSync(join(hostDir, "alpha", "index.html"), "utf-8")).toContain("Not installed yet");
  });

  it("skips installed tiles — leaves their slot untouched", () => {
    const tiles: MAppTile[] = [
      { id: "installed-mapp", name: "Real", description: "Real MApp", icon: "💰", installed: true },
      { id: "placeholder-mapp", name: "ph", description: "", icon: "📦", installed: false },
    ];
    const written = writePerMAppStandaloneHtml(hostDir, tiles);
    expect(written).toEqual(["placeholder-mapp"]);
    const fs = require("node:fs");
    expect(fs.existsSync(join(hostDir, "installed-mapp"))).toBe(false);
    expect(fs.existsSync(join(hostDir, "placeholder-mapp", "index.html"))).toBe(true);
  });

  it("is idempotent — re-writing overwrites the same file cleanly", () => {
    const tiles: MAppTile[] = [
      { id: "alpha", name: "A", description: "", icon: "📦", installed: false },
    ];
    writePerMAppStandaloneHtml(hostDir, tiles);
    writePerMAppStandaloneHtml(hostDir, tiles);
    const fs = require("node:fs");
    const html = fs.readFileSync(join(hostDir, "alpha", "index.html"), "utf-8");
    expect(html).toContain("alpha");
  });

  it("returns an empty list when no tiles are uninstalled", () => {
    const tiles: MAppTile[] = [
      { id: "real-1", name: "R1", description: "", icon: "💰", installed: true },
    ];
    const written = writePerMAppStandaloneHtml(hostDir, tiles);
    expect(written).toEqual([]);
  });
});
