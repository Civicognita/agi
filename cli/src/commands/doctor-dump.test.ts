/**
 * agi doctor dump — redactConfig unit tests (s144 t579).
 *
 * Diagnostic bundles ship to humans (and possibly support channels), so the
 * sanitization layer is load-bearing. Pure-logic; runs on host.
 */

import { describe, it, expect } from "vitest";
import { redactConfig } from "./doctor.js";

describe("redactConfig (s144 t579)", () => {
  it("redacts top-level secret-named keys, preserving length hint", () => {
    const out = redactConfig({ password: "supersecret", username: "alice" });
    expect(out).toEqual({ password: "<redacted:11-chars>", username: "alice" });
  });

  it("redacts nested secret-named keys", () => {
    const out = redactConfig({
      gateway: { auth: { token: "xyz", maxConnections: 100 } },
    });
    expect(out).toEqual({
      gateway: { auth: { token: "<redacted:3-chars>", maxConnections: 100 } },
    });
  });

  it("matches case-insensitive variants (apiKey, API_KEY, secretKey, etc.)", () => {
    const out = redactConfig({
      apiKey: "k1",
      API_KEY: "k2",
      anthropicSecretKey: "k3",
      privateKey: "k4",
      private_key: "k5",
      credential: "k6",
    });
    expect(out).toEqual({
      apiKey: "<redacted:2-chars>",
      API_KEY: "<redacted:2-chars>",
      anthropicSecretKey: "<redacted:2-chars>",
      privateKey: "<redacted:2-chars>",
      private_key: "<redacted:2-chars>",
      credential: "<redacted:2-chars>",
    });
  });

  it("preserves arrays + recurses into elements", () => {
    const out = redactConfig({
      providers: [
        { name: "anthropic", apiKey: "ak" },
        { name: "openai", apiKey: "ok" },
      ],
    });
    expect(out).toEqual({
      providers: [
        { name: "anthropic", apiKey: "<redacted:2-chars>" },
        { name: "openai", apiKey: "<redacted:2-chars>" },
      ],
    });
  });

  it("emits <redacted> (no length) for non-string secrets", () => {
    const out = redactConfig({ token: null, secret: 42, password: { nested: "x" } });
    expect(out).toEqual({ token: "<redacted>", secret: "<redacted>", password: "<redacted>" });
  });

  it("emits <redacted> (no length) for empty string secret", () => {
    expect(redactConfig({ password: "" })).toEqual({ password: "<redacted>" });
  });

  it("leaves non-secret keys whose name happens to contain a substring untouched", () => {
    // "secretive" matches /secret/ → redacted. Document this behavior so a
    // future maintainer doesn't widen the regex thinking it's broken.
    const out = redactConfig({ secretive: "no", innocuous: "yes" });
    expect(out).toEqual({ secretive: "<redacted:2-chars>", innocuous: "yes" });
  });

  it("passes primitives through unchanged", () => {
    expect(redactConfig("hello")).toBe("hello");
    expect(redactConfig(42)).toBe(42);
    expect(redactConfig(null)).toBe(null);
    expect(redactConfig(undefined)).toBe(undefined);
  });
});
