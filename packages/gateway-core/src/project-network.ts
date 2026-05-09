/**
 * project-network — per-project podman network management.
 *
 * Each project gets its own isolated podman network (`agi-net-<hostname>`)
 * so containers belonging to one project cannot reach containers in
 * another project by service DNS. Owner directive 2026-04-29 cycle 124:
 * "all repos need to be protected from other apps running on a network."
 *
 * Today's pattern: every project container joins the shared `aionima`
 * network. Cross-project reachability is implicit. This module is the
 * primitive layer that lets the hosting-manager move projects to
 * per-project isolation in a follow-up slice (B3b).
 *
 * Network lifecycle:
 *   - Created on project hosting enable (idempotent)
 *   - Destroyed on project hosting disable (with safety: only when no
 *     containers remain attached)
 *   - Caddy joins the network at create time so it can reverse-proxy
 *     to project containers via podman DNS
 *
 * Pure dep-injected I/O so unit tests can assert command shape without
 * touching real podman. Caller injects a `PodmanRunner` whose `run`
 * method synchronously dispatches `podman <args>` (e.g. via
 * `execFileSync` so arg array prevents shell injection).
 */

export interface PodmanRunner {
  /**
   * Synchronously dispatches `podman <args>`; returns stdout. Throws on
   * non-zero exit. Use `execFileSync` (NOT shell-style) so the args
   * array prevents injection. Caller injects so tests can mock without
   * spinning up real podman.
   */
  run: (args: string[]) => string;
}

export interface ProjectNetworkOptions {
  /** Project hostname slug (matches Caddy domain prefix). */
  hostname: string;
  /** Caddy container name to attach to the project's network. Defaults
   *  to "agi-caddy". */
  caddyContainerName?: string;
  /** Optional driver override. Default "bridge" — podman's default. */
  driver?: string;
}

/**
 * Stable network name for a project. Hostname is filesystem-safe per
 * the ProjectRepoSchema regex, so this is safe for podman.
 */
export function projectNetworkName(hostname: string): string {
  return `agi-net-${hostname}`;
}

/**
 * Check whether a podman network already exists. Uses `podman network
 * exists` (returns 0 when present, 1 when absent).
 */
export function networkExists(podman: PodmanRunner, networkName: string): boolean {
  try {
    podman.run(["network", "exists", networkName]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the per-project network if missing. Idempotent — safe to call
 * on every hosting-enable. Returns true when newly created, false when
 * already existed.
 */
export function ensureProjectNetwork(
  podman: PodmanRunner,
  options: ProjectNetworkOptions,
): { name: string; created: boolean } {
  const name = projectNetworkName(options.hostname);
  if (networkExists(podman, name)) {
    return { name, created: false };
  }
  const args = ["network", "create"];
  if (options.driver) args.push("--driver", options.driver);
  args.push(name);
  podman.run(args);
  return { name, created: true };
}

/**
 * Connect Caddy to a project's network so it can reverse-proxy to
 * project containers by podman DNS. Idempotent — `podman network
 * connect` is a no-op if Caddy is already attached. Errors are
 * surfaced (caller decides whether to log + continue or abort).
 */
export function connectCaddyToProjectNetwork(
  podman: PodmanRunner,
  options: ProjectNetworkOptions,
): { name: string; connected: boolean } {
  const name = projectNetworkName(options.hostname);
  const caddy = options.caddyContainerName ?? "agi-caddy";
  try {
    podman.run(["network", "connect", name, caddy]);
    return { name, connected: true };
  } catch (err) {
    // Already-connected error from podman → not a real failure
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already attached") || msg.includes("already connected")) {
      return { name, connected: false };
    }
    throw err;
  }
}

/**
 * Disconnect Caddy and remove the project's network. Called on project
 * hosting disable. Safety: refuses to remove if other containers are
 * still attached (would orphan them). Returns true when removed,
 * false when skipped due to lingering attachments or absent network.
 */
export function destroyProjectNetwork(
  podman: PodmanRunner,
  options: ProjectNetworkOptions,
): { name: string; destroyed: boolean; reason?: string } {
  const name = projectNetworkName(options.hostname);
  if (!networkExists(podman, name)) {
    return { name, destroyed: false, reason: "network does not exist" };
  }

  // Check for non-Caddy attachments. If anything besides agi-caddy is
  // attached, refuse — would orphan the container.
  const caddy = options.caddyContainerName ?? "agi-caddy";
  let attachments: string[] = [];
  try {
    const out = podman.run(["network", "inspect", name, "--format", "{{range .Containers}}{{.Name}} {{end}}"]);
    attachments = out.trim().split(/\s+/).filter((s) => s.length > 0);
  } catch {
    // inspect failed — be safe, refuse to delete
    return { name, destroyed: false, reason: "network inspect failed; refusing to delete" };
  }
  const nonCaddy = attachments.filter((a) => a !== caddy);
  if (nonCaddy.length > 0) {
    return { name, destroyed: false, reason: `containers still attached: ${nonCaddy.join(", ")}` };
  }

  // Disconnect Caddy first (errors ignored — best effort)
  try {
    podman.run(["network", "disconnect", name, caddy]);
  } catch { /* best effort */ }

  // Remove the network
  podman.run(["network", "rm", name]);
  return { name, destroyed: true };
}
