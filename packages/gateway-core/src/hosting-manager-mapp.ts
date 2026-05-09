/**
 * MApp container host (s145 t586) — minimal-but-real implementation.
 *
 * Replaces the t584 dispatch stub with a real container: nginx:alpine
 * serving a generated MApp Desktop index.html. The Desktop lists every
 * MApp configured via `hosting.mapps[]` as a clickable tile. Standalone
 * per-MApp routing (each MApp full-screen at /<mappId>/) is a follow-up
 * task that adds Caddy handle_path rules + per-MApp container topology.
 *
 * For owner-visible value TODAY: a project flagged
 * `containerKind: "mapp"` boots successfully (status=running) instead
 * of staying in the t584 stub state, AND `https://<project>.ai.on/`
 * renders a MApp Desktop the operator can see. Tiles for unknown MApp
 * IDs render as placeholders so the page is informative even before
 * the marketplace is populated.
 *
 * Pure functions are exported separately so unit tests can verify the
 * args + HTML shapes without spinning up a HostingManager.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal MApp metadata used by the Desktop tile renderer. Sourced from a
 * MApp's `manifest.json` in the marketplace cache when available; falls
 * back to placeholder fields when the MApp ID isn't installed.
 */
export interface MAppTile {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** True when the manifest was found; false when this is a placeholder. */
  installed: boolean;
}

export interface MAppContainerInput {
  /** Project hostname (e.g. "civicognita-ops") — used as the agi-host
   *  container name + label. */
  hostname: string;
  /** Absolute path to the project — used for the agi.project label so the
   *  cleanup loop can match this container to the right project. */
  projectPath: string;
  /** The container name (typically `agi-${hostname}`). */
  containerName: string;
  /** Configured MApp IDs from project.json hosting.mapps[]. */
  mappIds: string[];
  /** Path to the directory holding the generated index.html on host. The
   *  caller writes the HTML to this path before invoking podman; this
   *  function only emits the bind-mount string for it. */
  hostHtmlDir: string;
  /** Per-project podman network name — same as other hosting branches. */
  networkName: string;
  /** Optional tunnel hostname for HOSTNAME_ALLOWED_ORIGIN. Mirrors the
   *  other dispatch branches' env injection. */
  tunnelOrigin?: string | null;
  /** Image override (default: nginx:alpine). Tests use a lighter image. */
  image?: string;
}

export interface MAppContainerResult {
  args: string[];
  /** Echoed back so callers can log + audit the chosen image. */
  image: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Build podman run args for the MApp host container.
 *
 * Returns null when there are no MApps configured AND the caller wants to
 * skip cleanly (per current behavior, we still render a "no MApps yet"
 * desktop, so this never returns null in practice). Reserved for future
 * "skip when nothing to host" semantics.
 *
 * SECURITY NOTE: the index.html is bind-mounted read-only. The container
 * image is fixed (nginx:alpine) — no user-controlled image string flows
 * through this code path.
 */
export function buildMAppContainerArgsPure(input: MAppContainerInput): MAppContainerResult {
  const image = input.image ?? "nginx:alpine";

  const args: string[] = [
    "run", "-d",
    "--name", input.containerName,
    "--restart=always",
    "--label", "agi.managed=true",
    "--label", `agi.hostname=${input.hostname}`,
    "--label", `agi.project=${input.projectPath}`,
    "--label", "agi.container-kind=mapp",
    `--network=${input.networkName}`,
    // Read-only bind of the generated index.html dir at the nginx web root.
    "-v", `${input.hostHtmlDir}:/usr/share/nginx/html:ro,Z`,
  ];

  if (input.tunnelOrigin) {
    args.push("-e", `HOSTNAME_ALLOWED_ORIGIN=${input.tunnelOrigin}`);
  }

  args.push(image);

  return { args, image };
}

/**
 * Render the MApp Desktop HTML. Plain hand-rolled HTML+CSS — no build
 * step, no JS framework. The Desktop is intentionally simple: a tile
 * grid where each tile is a MApp from the configured list. Known MApps
 * (manifest found) render with their name/description; unknown IDs
 * render as placeholders so the operator sees what's configured even
 * if the MApp hasn't been installed from the marketplace yet.
 *
 * The "open standalone" link on each tile points at /<mappId>/ — this
 * route doesn't exist yet (follow-up task wires Caddy handle_path +
 * per-MApp container). For now, clicking shows a 404 with a helpful
 * message. We document this status in the page footer.
 */
export function generateMAppDesktopHtml(input: {
  hostname: string;
  tiles: MAppTile[];
}): string {
  const { hostname, tiles } = input;

  const tileMarkup = tiles.length === 0
    ? `<div class="empty">
         <h2>No MApps configured yet</h2>
         <p>Add MApp IDs to <code>hosting.mapps</code> on this project from the dashboard's Hosting tab.</p>
       </div>`
    : tiles.map((tile) => `
        <a class="tile ${tile.installed ? "tile--installed" : "tile--placeholder"}" href="/${escapeHtml(tile.id)}/">
          <div class="tile__icon">${escapeHtml(tile.icon)}</div>
          <div class="tile__body">
            <h3>${escapeHtml(tile.name)}</h3>
            <p>${escapeHtml(tile.description)}</p>
            ${tile.installed ? "" : `<span class="tile__pending">Not installed yet</span>`}
          </div>
        </a>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MApps — ${escapeHtml(hostname)}</title>
  <style>
    :root { color-scheme: dark; --bg: #0a0a0a; --card: #161616; --border: #2a2a2a; --fg: #e6e6e6; --muted: #888; --accent: #4a9eff; --pending: #d97706; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); }
    header { margin-bottom: 32px; }
    header h1 { margin: 0 0 4px 0; font-size: 18px; font-weight: 600; }
    header p { margin: 0; color: var(--muted); font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
    .tile { display: block; padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; text-decoration: none; color: inherit; transition: border-color 150ms; }
    .tile:hover { border-color: var(--accent); }
    .tile--placeholder { opacity: 0.6; }
    .tile__icon { font-size: 28px; margin-bottom: 12px; }
    .tile__body h3 { margin: 0 0 4px 0; font-size: 14px; font-weight: 600; }
    .tile__body p { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.4; }
    .tile__pending { display: inline-block; margin-top: 8px; padding: 2px 6px; font-size: 10px; font-weight: 600; text-transform: uppercase; color: var(--pending); border: 1px solid var(--pending); border-radius: 4px; }
    .empty { padding: 48px 0; text-align: center; }
    .empty h2 { font-size: 16px; font-weight: 500; }
    .empty p { color: var(--muted); font-size: 13px; }
    .empty code { padding: 2px 4px; background: var(--card); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; }
    footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); text-align: center; }
    footer code { padding: 2px 4px; background: var(--card); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; }
  </style>
</head>
<body>
  <header>
    <h1>MApp Desktop</h1>
    <p>${escapeHtml(hostname)} · ${tiles.length} ${tiles.length === 1 ? "MApp" : "MApps"} configured</p>
  </header>
  <main class="grid">
${tileMarkup}
  </main>
  <footer>
    Standalone MApp routing is a follow-up task (s145 t586+). For now, tile clicks resolve to <code>/&lt;mappId&gt;/</code> which returns 404 until per-MApp serving lands.
  </footer>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------------------
// Tile resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the metadata for each MApp ID. Tries to read the MApp's
 * manifest.json from the marketplace cache; falls back to a placeholder
 * tile when the MApp isn't installed (so configurations referencing
 * unbuilt MApps still render informatively).
 *
 * Marketplace cache layout (per agi/docs/agents/magic-apps.md):
 *   ~/.agi/mapps/cache/<mappId>/manifest.json
 *
 * The manifest fields used here are tolerant of missing keys:
 *   name        → falls back to the MApp ID
 *   description → falls back to a generic "(no description)"
 *   icon        → falls back to a generic "📦" (package emoji)
 */
export function resolveMAppTiles(mappIds: string[], cacheRoot?: string): MAppTile[] {
  const root = cacheRoot ?? join(homedir(), ".agi", "mapps", "cache");
  return mappIds.map((id) => {
    const manifestPath = resolvePath(root, id, "manifest.json");
    if (!existsSync(manifestPath)) {
      return {
        id,
        name: id,
        description: "Not installed in MApp Marketplace yet.",
        icon: "📦",
        installed: false,
      };
    }
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        name?: string;
        description?: string;
        icon?: string;
      };
      return {
        id,
        name: raw.name ?? id,
        description: raw.description ?? "(no description)",
        icon: raw.icon ?? "📦",
        installed: true,
      };
    } catch {
      return {
        id,
        name: id,
        description: "Manifest could not be parsed.",
        icon: "⚠️",
        installed: false,
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Host directory + index.html writer
// ---------------------------------------------------------------------------

/**
 * Resolve the on-host directory where this project's MApp Desktop
 * index.html lives. One dir per project, keyed by hostname so the
 * dashboard + cleanup loops can find it.
 *
 * Default location: ~/.agi/mapps/host/<hostname>/. Tests can override
 * the root for isolation.
 */
export function resolveMAppHostDir(hostname: string, hostRoot?: string): string {
  const root = hostRoot ?? join(homedir(), ".agi", "mapps", "host");
  return resolvePath(root, hostname);
}

/**
 * Write the generated index.html into the host directory, creating the
 * dir if needed. Idempotent — re-writes on every container start so
 * config changes (added/removed MApps) reflect immediately.
 */
export function writeMAppDesktopHtml(hostDir: string, html: string): void {
  if (!existsSync(hostDir)) {
    mkdirSync(hostDir, { recursive: true });
  }
  writeFileSync(join(hostDir, "index.html"), html, "utf-8");
}

// ---------------------------------------------------------------------------
// Per-MApp standalone placeholder (s145 t589)
// ---------------------------------------------------------------------------

/**
 * Render the standalone "this MApp isn't installed yet" page that the
 * project's nginx container serves at `/<mappId>/`. When the operator
 * clicks a placeholder tile on the MApp Desktop, this is what they see
 * — a project-aware install-CTA page instead of nginx's generic 404.
 *
 * When real MApps are installed in the marketplace cache, the writer
 * (writePerMAppStandaloneHtml below) skips overwriting their slot — so
 * the real MApp's bundled HTML/JS/assets stay intact. This placeholder
 * is strictly the "not installed yet" surface.
 *
 * The page is intentionally small. It's plain HTML+CSS, dark theme to
 * match the MApp Desktop, and includes a back-link to `/`.
 */
export function generateMAppPlaceholderHtml(input: {
  mappId: string;
  hostname: string;
}): string {
  const { mappId, hostname } = input;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(mappId)} — Not installed · ${escapeHtml(hostname)}</title>
  <style>
    :root { color-scheme: dark; --bg: #0a0a0a; --card: #161616; --border: #2a2a2a; --fg: #e6e6e6; --muted: #888; --accent: #4a9eff; --pending: #d97706; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 48px; max-width: 480px; width: 100%; text-align: center; }
    .badge { display: inline-block; padding: 4px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--pending); border: 1px solid var(--pending); border-radius: 4px; margin-bottom: 16px; }
    h1 { margin: 0 0 8px 0; font-size: 20px; font-weight: 600; }
    h1 code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 18px; color: var(--accent); }
    p { margin: 0 0 16px 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
    .back { display: inline-block; margin-top: 16px; padding: 8px 20px; color: var(--fg); text-decoration: none; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
    .back:hover { border-color: var(--accent); }
    code.path { padding: 2px 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Not installed yet</span>
    <h1><code>${escapeHtml(mappId)}</code></h1>
    <p>This MApp is configured for <strong>${escapeHtml(hostname)}</strong> but isn't installed in the MApp Marketplace cache yet.</p>
    <p>Install it from the MApp Marketplace and the gateway will populate <code class="path">~/.agi/mapps/cache/${escapeHtml(mappId)}/</code> on the next dispatch.</p>
    <a class="back" href="/">← Back to MApp Desktop</a>
  </div>
</body>
</html>
`;
}

/**
 * Write per-MApp standalone HTML pages into the host directory.
 *
 * For each tile: if installed (manifest found), SKIP — leave the real
 * MApp's bundle in place. If placeholder (no manifest), write a
 * "not installed yet" page at `${hostDir}/${mappId}/index.html`.
 *
 * Returns the list of mappIds that got placeholder pages written. Used
 * by callers for logging + e2e assertions.
 */
export function writePerMAppStandaloneHtml(
  hostDir: string,
  tiles: ReadonlyArray<MAppTile>,
): string[] {
  const written: string[] = [];
  for (const tile of tiles) {
    if (tile.installed) continue;
    const mappDir = join(hostDir, tile.id);
    if (!existsSync(mappDir)) {
      mkdirSync(mappDir, { recursive: true });
    }
    const html = generateMAppPlaceholderHtml({
      mappId: tile.id,
      hostname: hostDir.split("/").pop() ?? "project",
    });
    writeFileSync(join(mappDir, "index.html"), html, "utf-8");
    written.push(tile.id);
  }
  return written;
}
