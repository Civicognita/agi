import { describe, it, expect } from "vitest";
import {
  projectNetworkName,
  networkExists,
  ensureProjectNetwork,
  connectCaddyToProjectNetwork,
  destroyProjectNetwork,
  type PodmanRunner,
} from "./project-network.js";

/**
 * Build a mock PodmanRunner that records every invocation and replays
 * canned responses. Each test arranges its own response queue.
 */
function makeMockPodman(scripted: Array<string | Error>): PodmanRunner & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const queue = [...scripted];
  return {
    calls,
    run: (args: string[]) => {
      calls.push(args);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next ?? "";
    },
  };
}

describe("projectNetworkName", () => {
  it("prefixes hostname with agi-net-", () => {
    expect(projectNetworkName("my-app")).toBe("agi-net-my-app");
    expect(projectNetworkName("aionima_test_42")).toBe("agi-net-aionima_test_42");
  });
});

describe("networkExists", () => {
  it("returns true when podman network exists succeeds", () => {
    const p = makeMockPodman([""]);
    expect(networkExists(p, "agi-net-foo")).toBe(true);
    expect(p.calls[0]).toEqual(["network", "exists", "agi-net-foo"]);
  });

  it("returns false when podman network exists throws", () => {
    const p = makeMockPodman([new Error("network not found")]);
    expect(networkExists(p, "agi-net-missing")).toBe(false);
  });
});

describe("ensureProjectNetwork", () => {
  it("creates the network when missing", () => {
    const p = makeMockPodman([
      new Error("not found"), // network exists check fails
      "",                     // network create succeeds
    ]);
    const result = ensureProjectNetwork(p, { hostname: "blog" });
    expect(result).toEqual({ name: "agi-net-blog", created: true });
    expect(p.calls[0]).toEqual(["network", "exists", "agi-net-blog"]);
    expect(p.calls[1]).toEqual(["network", "create", "agi-net-blog"]);
  });

  it("skips creation when network already exists", () => {
    const p = makeMockPodman([""]); // network exists check succeeds
    const result = ensureProjectNetwork(p, { hostname: "blog" });
    expect(result).toEqual({ name: "agi-net-blog", created: false });
    expect(p.calls).toHaveLength(1);
  });

  it("threads driver override into the create command", () => {
    const p = makeMockPodman([new Error("not found"), ""]);
    ensureProjectNetwork(p, { hostname: "x", driver: "macvlan" });
    expect(p.calls[1]).toEqual(["network", "create", "--driver", "macvlan", "agi-net-x"]);
  });
});

describe("connectCaddyToProjectNetwork", () => {
  it("connects agi-caddy by default", () => {
    const p = makeMockPodman([""]);
    const result = connectCaddyToProjectNetwork(p, { hostname: "blog" });
    expect(result).toEqual({ name: "agi-net-blog", connected: true });
    expect(p.calls[0]).toEqual(["network", "connect", "agi-net-blog", "agi-caddy"]);
  });

  it("uses caddyContainerName override when provided", () => {
    const p = makeMockPodman([""]);
    connectCaddyToProjectNetwork(p, { hostname: "blog", caddyContainerName: "agi-caddy-dev" });
    expect(p.calls[0]).toEqual(["network", "connect", "agi-net-blog", "agi-caddy-dev"]);
  });

  it("treats already-attached as success (idempotent)", () => {
    const p = makeMockPodman([new Error("already attached to network")]);
    const result = connectCaddyToProjectNetwork(p, { hostname: "blog" });
    expect(result).toEqual({ name: "agi-net-blog", connected: false });
  });

  it("treats already-connected as success (alternate podman wording)", () => {
    const p = makeMockPodman([new Error("container is already connected to network")]);
    const result = connectCaddyToProjectNetwork(p, { hostname: "blog" });
    expect(result.connected).toBe(false);
  });

  it("rethrows real errors", () => {
    const p = makeMockPodman([new Error("network does not exist")]);
    expect(() => connectCaddyToProjectNetwork(p, { hostname: "ghost" })).toThrow();
  });
});

describe("destroyProjectNetwork", () => {
  it("returns destroyed: false when network does not exist", () => {
    const p = makeMockPodman([new Error("not found")]);
    const result = destroyProjectNetwork(p, { hostname: "ghost" });
    expect(result.destroyed).toBe(false);
    expect(result.reason).toContain("does not exist");
  });

  it("removes the network when only Caddy is attached", () => {
    const p = makeMockPodman([
      "",            // network exists check succeeds
      "agi-caddy",   // inspect returns only Caddy
      "",            // network disconnect succeeds
      "",            // network rm succeeds
    ]);
    const result = destroyProjectNetwork(p, { hostname: "blog" });
    expect(result).toEqual({ name: "agi-net-blog", destroyed: true });
    expect(p.calls.map((c) => c[0] + " " + c[1])).toEqual([
      "network exists",
      "network inspect",
      "network disconnect",
      "network rm",
    ]);
  });

  it("refuses to remove when other containers are attached", () => {
    const p = makeMockPodman([
      "",                                // network exists check succeeds
      "agi-caddy agi-blog-container",    // inspect: Caddy + project container
    ]);
    const result = destroyProjectNetwork(p, { hostname: "blog" });
    expect(result.destroyed).toBe(false);
    expect(result.reason).toContain("still attached");
    expect(result.reason).toContain("agi-blog-container");
    // network rm NOT called (would orphan the container)
    expect(p.calls.find((c) => c[0] === "network" && c[1] === "rm")).toBeUndefined();
  });

  it("refuses to remove when inspect fails (safety)", () => {
    const p = makeMockPodman([
      "",                               // network exists check succeeds
      new Error("inspect failed"),      // inspect throws
    ]);
    const result = destroyProjectNetwork(p, { hostname: "blog" });
    expect(result.destroyed).toBe(false);
    expect(result.reason).toContain("inspect failed");
  });

  it("treats disconnect failures as best-effort and still removes", () => {
    const p = makeMockPodman([
      "",                              // network exists
      "agi-caddy",                     // only Caddy attached
      new Error("disconnect failed"),  // disconnect throws — ignored
      "",                              // rm succeeds
    ]);
    const result = destroyProjectNetwork(p, { hostname: "blog" });
    expect(result.destroyed).toBe(true);
  });
});

describe("integration shape — full enable + disable lifecycle", () => {
  it("enable: ensure network + connect Caddy", () => {
    const p = makeMockPodman([
      new Error("not found"),    // ensureProjectNetwork: exists check
      "",                        // ensureProjectNetwork: create
      "",                        // connectCaddyToProjectNetwork: connect
    ]);
    const ensured = ensureProjectNetwork(p, { hostname: "blog" });
    const connected = connectCaddyToProjectNetwork(p, { hostname: "blog" });
    expect(ensured.created).toBe(true);
    expect(connected.connected).toBe(true);
  });

  it("disable: tear down only when project containers gone", () => {
    const p = makeMockPodman([
      "",            // exists check
      "agi-caddy",   // inspect: only Caddy left
      "",            // disconnect Caddy
      "",            // rm network
    ]);
    const result = destroyProjectNetwork(p, { hostname: "blog" });
    expect(result.destroyed).toBe(true);
  });
});
