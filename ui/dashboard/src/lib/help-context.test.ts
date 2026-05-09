/**
 * resolveHelpContext tests (s137 t530). Pure-logic; runs on host.
 */

import { describe, it, expect } from "vitest";
import { resolveHelpContext } from "./help-context.js";

describe("resolveHelpContext (s137 t530)", () => {
  it("maps known top-level routes to descriptive strings", () => {
    expect(resolveHelpContext("/")).toBe("dashboard overview");
    expect(resolveHelpContext("/projects")).toBe("projects browser");
    expect(resolveHelpContext("/settings/providers")).toBe("providers + models management");
    expect(resolveHelpContext("/system/services")).toBe("system services + circuit breakers");
    expect(resolveHelpContext("/marketplace")).toBe("Plugin Marketplace catalog");
  });

  it("normalizes trailing slashes (except for root)", () => {
    expect(resolveHelpContext("/projects/")).toBe("projects browser");
    expect(resolveHelpContext("/")).toBe("dashboard overview");
  });

  it("flattens /projects/:slug to a project workspace string", () => {
    expect(resolveHelpContext("/projects/my-app")).toBe('workspace for project "my-app"');
    expect(resolveHelpContext("/projects/scope%2Fsub")).toBe('workspace for project "scope/sub"');
  });

  it("flattens /projects/:slug/:tab to a per-tab string", () => {
    expect(resolveHelpContext("/projects/my-app/files")).toBe('files tab in workspace "my-app"');
    expect(resolveHelpContext("/projects/my-app/hosting/manage")).toBe('hosting/manage tab in workspace "my-app"');
  });

  it("flattens marketplace detail routes", () => {
    expect(resolveHelpContext("/marketplace/plugins/postgres-stack")).toBe('plugin "postgres-stack" detail');
    expect(resolveHelpContext("/marketplace/mapps/whodb")).toBe('MApp "whodb" detail');
  });

  it("flattens entity / comms / knowledge / docs detail routes", () => {
    expect(resolveHelpContext("/entity/E0")).toBe('entity "E0" detail');
    expect(resolveHelpContext("/comms/slack")).toBe("comms — slack channel");
    expect(resolveHelpContext("/knowledge/aion-prime")).toBe('knowledge namespace "aion-prime"');
    expect(resolveHelpContext("/docs/getting-started")).toBe("docs reader: getting-started");
    expect(resolveHelpContext("/docs/agents/system-prompt-assembly.md")).toBe("docs reader: agents/system-prompt-assembly.md");
  });

  it("flattens MApp editor route", () => {
    expect(resolveHelpContext("/mapp-editor/sample-app")).toBe('MApp editor for "sample-app"');
  });

  it("falls back to 'unknown route <path>' for routes not yet listed", () => {
    expect(resolveHelpContext("/some/new/page")).toBe("unknown route /some/new/page");
    expect(resolveHelpContext("/x")).toBe("unknown route /x");
  });

  it("handles empty / non-string input safely", () => {
    expect(resolveHelpContext("")).toBe("unknown route");
    expect(resolveHelpContext(undefined as unknown as string)).toBe("unknown route");
    expect(resolveHelpContext(null as unknown as string)).toBe("unknown route");
  });

  it("static-route match wins over pattern-route match (for routes that look ambiguous)", () => {
    // /knowledge is a static route ("knowledge namespaces"). /knowledge/foo
    // matches the pattern. Verifying both render correctly.
    expect(resolveHelpContext("/knowledge")).toBe("knowledge namespaces");
    expect(resolveHelpContext("/knowledge/aion-prime")).toBe('knowledge namespace "aion-prime"');
  });
});
