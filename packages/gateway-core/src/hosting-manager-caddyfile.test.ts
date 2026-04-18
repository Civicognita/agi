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
    expect(out).toContain("reverse_proxy localhost:5050");
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
    expect(out).toContain("reverse_proxy localhost:5050"); // new WhoDB port, not the legacy 3100
  });

  it("respects a custom whodbPort when provided", () => {
    const out = buildCaddyfileContent({ ...baseOpts, whodbPort: 8080 });
    expect(out).toContain("reverse_proxy localhost:8080");
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
    expect(out).toContain("reverse_proxy localhost:3200");
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
        { subdomain: "papa", target: 18789 },
        { subdomain: "admin", target: "gateway" },
      ],
    });
    expect(out).toContain("papa.ai.on {");
    expect(out).toContain("reverse_proxy localhost:18789");
    expect(out).toContain("admin.ai.on {");
    expect(out).toContain("reverse_proxy localhost:3100"); // "gateway" resolves to gatewayPort
  });

  it("writes project blocks in the PROJECT DOMAINS section", () => {
    const out = buildCaddyfileContent({
      ...baseOpts,
      projects: [
        { hostname: "blog", containerIp: "10.89.0.2", internalPort: 3000 },
        { hostname: "shop", containerIp: "10.89.0.3", internalPort: 80 },
      ],
    });
    const projStart = out.indexOf("# === PROJECT DOMAINS ===");
    const projEnd = out.indexOf("# === END PROJECT DOMAINS ===");
    expect(projStart).toBeGreaterThan(-1);
    expect(projEnd).toBeGreaterThan(projStart);
    const projSection = out.slice(projStart, projEnd);
    expect(projSection).toContain("blog.ai.on {");
    expect(projSection).toContain("reverse_proxy 10.89.0.2:3000");
    expect(projSection).toContain("shop.ai.on {");
    expect(projSection).toContain("reverse_proxy 10.89.0.3:80");
  });
});
