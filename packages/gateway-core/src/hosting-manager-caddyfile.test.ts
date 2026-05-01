/**
 * hosting-manager — Caddyfile content generation tests.
 *
 * Regression guard for the SYSTEM-section preservation bug: previously,
 * `regenerateCaddyfile()` preserved the existing SYSTEM block verbatim when
 * no plugin had registered a subdomain at the moment of the call. This meant
 * new directives (e.g. the WhoDB `X-Frame-Options` strip added in 858de1b)
 * were never written to the deployed Caddyfile on existing installs.
 *
 * The fix: always regenerate the SYSTEM block from current code; preserve only
 * the user-editable CUSTOM block. These tests lock that behavior in.
 */

import { describe, it, expect } from "vitest";
import { buildCaddyfileContent } from "./hosting-manager.js";

const baseOpts = {
  baseDomain: "ai.on",
  gatewayPort: 3100,
  pluginSubdomainRoutes: [],
  projects: [],
  existingCaddyfile: "",
};

describe("buildCaddyfileContent — WhoDB block", () => {
  it("always strips X-Frame-Options and rewrites CSP, even with no prior Caddyfile", () => {
    const out = buildCaddyfileContent(baseOpts);
    expect(out).toContain("db.ai.on {");
    expect(out).toContain("header -X-Frame-Options");
    expect(out).toContain("header -Content-Security-Policy");
    expect(out).toContain(`header Content-Security-Policy "frame-ancestors 'self' https://ai.on https://*.ai.on"`);
    // Caddy-on-aionima (story #100) — WhoDB reached by container DNS on the
    // aionima podman network, not localhost. Default container name is
    // `agi-whodb`; default internal port is 8080.
    expect(out).toContain("reverse_proxy agi-whodb:8080");
  });

  it("still emits header strips when an existing Caddyfile has the OLD unfixed block", () => {
    // Regression: with the preservation bug, this existingCaddyfile would have
    // been kept verbatim and the new directives never written.
    const legacyCaddyfile = `
# === SYSTEM DOMAINS ===

ai.on {
    tls internal
    reverse_proxy localhost:3100
}

db.ai.on {
    tls internal
    reverse_proxy localhost:3100
}

# --- BEGIN CUSTOM ---
# --- END CUSTOM ---

# === END SYSTEM DOMAINS ===
`;
    const out = buildCaddyfileContent({ ...baseOpts, existingCaddyfile: legacyCaddyfile });
    expect(out).toContain("header -X-Frame-Options");
    // New DNS-based WhoDB upstream; must not keep the legacy localhost:3100.
    expect(out).toContain("reverse_proxy agi-whodb:8080");
    expect(out).not.toContain("reverse_proxy localhost:3100");
  });

  it("respects a custom whodbPort when provided", () => {
    const out = buildCaddyfileContent({ ...baseOpts, whodbPort: 5050 });
    expect(out).toContain("reverse_proxy agi-whodb:5050");
  });

  it("emits handle_path blocks for non-default repos (s130 t515 B5)", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      projects: [{
        hostname: "myapp",
        port: 4001,
        containerName: "agi-myapp",
        internalPort: 5173, // default repo's port
        repos: [
          { name: "api", port: 8001, externalPath: "/api" },
          { name: "admin", port: 8002, externalPath: "/admin" },
        ],
      }],
    });
    // Project's site block contains handle_path for each non-default repo
    expect(out).toContain("handle_path /api/* {");
    expect(out).toContain("reverse_proxy agi-myapp:8001");
    expect(out).toContain("handle_path /admin/* {");
    expect(out).toContain("reverse_proxy agi-myapp:8002");
    // Default repo still has the catch-all reverse_proxy on the default port
    expect(out).toContain("reverse_proxy agi-myapp:5173");
    // handle_path blocks must appear BEFORE the catch-all reverse_proxy
    // (Caddy matches in order; catch-all-first would shadow)
    const apiIdx = out.indexOf("handle_path /api/*");
    const catchAllIdx = out.indexOf("reverse_proxy agi-myapp:5173");
    expect(apiIdx).toBeLessThan(catchAllIdx);
  });

  it("works without repos array (single-repo project unchanged)", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      projects: [{
        hostname: "single",
        port: 4001,
        containerName: "agi-single",
        internalPort: 3000,
      }],
    });
    // No handle_path blocks
    expect(out).not.toContain("handle_path");
    // Plain reverse_proxy still emitted
    expect(out).toContain("reverse_proxy agi-single:3000");
  });

  it("normalizes externalPath without leading slash", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      projects: [{
        hostname: "myapp",
        containerName: "agi-myapp",
        internalPort: 5173,
        repos: [
          // Schema enforces leading-/, but defensive normalization
          // handles operator-edited config that might omit it
          { name: "api", port: 8001, externalPath: "api" },
        ],
      }],
    });
    expect(out).toContain("handle_path /api/* {");
  });

  it("emits 7-day TLS lifetime as the long-form tls block on every internal cert (s130 t515 B2 cycle 124, s141 cycle 152 long-form for Caddy lexer + 'lifetime' semantic)", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      idService: { enabled: true },
      pluginSubdomainRoutes: [{ subdomain: "myplugin", target: 5000, containerName: "agi-myplugin" }],
      projects: [{ hostname: "my-app", port: 4001, containerName: "agi-my-app", internalPort: 3000 }],
    });
    // Owner directive cycle 124: 7-day cert lifetime.
    // Cycle 152: must use the long-form `tls { issuer internal { lifetime
    // 168h } }`. The shorthand `tls internal { lifetime 168h }` failed in
    // Caddy two different ways — the one-liner tripped the lexer
    // ("Unexpected next token after '{' on same line"), and the
    // multi-line variant of the same shorthand tripped the parser
    // ("unknown subdirective: lifetime"). `lifetime` is a subdirective of
    // the `internal` issuer, not of the `tls internal` shorthand.
    //
    // Regex matches the indented multi-line form:
    //     tls {
    //         issuer internal {
    //             lifetime 168h
    //         }
    //     }
    const lifetimeMatches =
      out.match(/tls \{\n\s+issuer internal \{\n\s+lifetime 168h\n\s+\}\n\s+\}/g) ?? [];
    // gateway + db + id + plugin + project = 5 sites that emit `tls internal`
    expect(lifetimeMatches.length).toBe(5);
    // Hard regression guards: neither broken shape can silently reappear.
    // (a) one-liner shorthand
    expect(out).not.toMatch(/tls internal \{[^\n]*lifetime/);
    // (b) multi-line shorthand still has lifetime as a child of `tls internal`
    expect(out).not.toMatch(/tls internal \{\n\s+lifetime/);
    // No leftover bare `tls internal` (without issuer block) — would mean a
    // site forgot the constant.
    expect(out).not.toMatch(/tls internal$\n/m);
    expect(out).not.toMatch(/tls internal\s*$/m);
  });

  it("honors a custom whodbContainerName when provided", () => {
    const out = buildCaddyfileContent({ ...baseOpts, whodbContainerName: "agi-whodb-dev" });
    expect(out).toContain("reverse_proxy agi-whodb-dev:8080");
  });

  it("includes domain aliases in the frame-ancestors CSP", () => {
    const out = buildCaddyfileContent({ ...baseOpts, domainAliases: ["aionima.local", "aion.dev"] });
    expect(out).toContain(
      `header Content-Security-Policy "frame-ancestors 'self' https://ai.on https://*.ai.on https://aionima.local https://*.aionima.local https://aion.dev https://*.aion.dev"`,
    );
  });
});

describe("buildCaddyfileContent — section layout", () => {
  it("always emits the SYSTEM section with gateway, WhoDB, and CUSTOM markers", () => {
    const out = buildCaddyfileContent(baseOpts);
    expect(out).toContain("# === SYSTEM DOMAINS ===");
    expect(out).toContain("# === END SYSTEM DOMAINS ===");
    expect(out).toContain("# === PROJECT DOMAINS ===");
    expect(out).toContain("# === END PROJECT DOMAINS ===");
    // Gateway block
    expect(out).toContain("ai.on {");
    // WhoDB block
    expect(out).toContain("db.ai.on {");
    // Empty custom markers present
    expect(out).toContain("# --- BEGIN CUSTOM ---");
    expect(out).toContain("# --- END CUSTOM ---");
  });

  it("preserves the CUSTOM block verbatim from an existing Caddyfile", () => {
    const existing = `
# === SYSTEM DOMAINS ===
# --- BEGIN CUSTOM ---
papa.ai.on {
    tls internal
    reverse_proxy localhost:18789
}
# --- END CUSTOM ---
# === END SYSTEM DOMAINS ===
`;
    const out = buildCaddyfileContent({ ...baseOpts, existingCaddyfile: existing });
    expect(out).toContain("papa.ai.on {");
    expect(out).toContain("reverse_proxy localhost:18789");
  });

  it("writes an ID service block when idService.enabled is true", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      idService: { enabled: true, subdomain: "id", port: 3200 },
    });
    expect(out).toContain("id.ai.on {");
    // ID reached by container DNS on aionima; default container is `agi-local-id`.
    expect(out).toContain("reverse_proxy agi-local-id:3200");
  });

  it("skips the ID service block when idService.enabled is false or undefined", () => {
    const out = buildCaddyfileContent(baseOpts);
    expect(out).not.toContain("id.ai.on {");
  });

  it("writes zero plugin subdomain blocks when no routes are provided (no crash)", () => {
    const out = buildCaddyfileContent(baseOpts);
    // Must still have SYSTEM markers and gateway + whodb
    expect(out).toContain("ai.on {");
    expect(out).toContain("db.ai.on {");
  });

  it("writes plugin subdomain blocks when routes exist", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      pluginSubdomainRoutes: [
        // Legacy route (no containerName) — falls back to host.containers.internal
        { subdomain: "papa", target: 18789 },
        // Route targeted at AGI gateway (on host) — resolved via host bridge
        { subdomain: "admin", target: "gateway" },
        // Aionima-native route — container DNS
        { subdomain: "myapp", target: 3000, containerName: "agi-myapp" },
      ],
    });
    expect(out).toContain("papa.ai.on {");
    expect(out).toContain("reverse_proxy host.containers.internal:18789");
    expect(out).toContain("admin.ai.on {");
    expect(out).toContain("reverse_proxy host.containers.internal:3100");
    expect(out).toContain("myapp.ai.on {");
    expect(out).toContain("reverse_proxy agi-myapp:3000");
  });

  it("writes project blocks in the PROJECT DOMAINS section using container DNS when available", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      projects: [
        { hostname: "blog", port: 4001, containerName: "agi-blog", internalPort: 3000 },
        { hostname: "shop", port: 4002, containerName: "agi-shop", internalPort: 80 },
      ],
    });
    const projStart = out.indexOf("# === PROJECT DOMAINS ===");
    const projEnd = out.indexOf("# === END PROJECT DOMAINS ===");
    expect(projStart).toBeGreaterThan(-1);
    expect(projEnd).toBeGreaterThan(projStart);
    const projSection = out.slice(projStart, projEnd);
    expect(projSection).toContain("blog.ai.on {");
    expect(projSection).toContain("reverse_proxy agi-blog:3000");
    expect(projSection).toContain("shop.ai.on {");
    expect(projSection).toContain("reverse_proxy agi-shop:80");
  });

  it("falls back to host.containers.internal when a project has no containerName yet", () => {
    // Pre-migration projects without containerName/internalPort keep working
    // through the host bridge until they re-launch.
    const out = buildCaddyfileContent({
      ...baseOpts,
      projects: [{ hostname: "legacy-blog", port: 4099 }],
    });
    const projStart = out.indexOf("# === PROJECT DOMAINS ===");
    const projEnd = out.indexOf("# === END PROJECT DOMAINS ===");
    const projSection = out.slice(projStart, projEnd);
    expect(projSection).toContain("legacy-blog.ai.on {");
    expect(projSection).toContain("reverse_proxy host.containers.internal:4099");
  });

  it("adds a 5xx-filtered handle_errors fallback block in each project block", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      projects: [{ hostname: "my-app", port: 4001, containerName: "agi-my-app", internalPort: 3000 }],
    });
    const projStart = out.indexOf("# === PROJECT DOMAINS ===");
    const projEnd = out.indexOf("# === END PROJECT DOMAINS ===");
    const projSection = out.slice(projStart, projEnd);
    // Caddy 2.6 compatibility — use expression-matcher form, not the
    // status-code filter (`handle_errors 502 503 504`) which requires
    // Caddy 2.8+.
    expect(projSection).toContain("handle_errors {");
    expect(projSection).not.toContain("handle_errors 502 503 504");
    expect(projSection).toContain("@5xx expression");
    expect(projSection).toContain("{http.error.status_code} >= 500");
    expect(projSection).toContain("handle @5xx {");
    expect(projSection).toContain("respond `");
    expect(projSection).toContain("503");
    expect(projSection).toContain("Container not running");
    expect(projSection).toContain("my-app");
    // Content-Type header MUST be set inside handle @5xx — Caddy's
    // `respond` defaults to text/plain, which renders the offline
    // HTML as raw source. Cycle-122 owner-reported regression.
    expect(projSection).toContain('header Content-Type "text/html; charset=utf-8"');
  });

  it("uses the provided name in the offline page when name differs from hostname", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      projects: [{ hostname: "my-app", port: 4001, containerName: "agi-my-app", internalPort: 3000, name: "My Blog" }],
    });
    expect(out).toContain("My Blog");
  });
});
