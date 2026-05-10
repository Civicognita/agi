import { describe, it, expect } from "vitest";
import {
  HELP_MODE_TOOL_ALLOWLIST,
  HELP_MODE_TOOL_DENYLIST,
  helpModeContextSlice,
  helpModeFiltersTool,
  isHelpModeContext,
} from "./help-mode-config.js";

describe("isHelpModeContext (s137 t532 Phase 1)", () => {
  it("true for help: prefix", () => {
    expect(isHelpModeContext("help:projects browser")).toBe(true);
    expect(isHelpModeContext("help:providers + models management")).toBe(true);
  });

  it("false for non-help-mode contexts", () => {
    expect(isHelpModeContext("project:myproject")).toBe(false);
    expect(isHelpModeContext("global")).toBe(false);
    expect(isHelpModeContext("")).toBe(false);
    expect(isHelpModeContext(null)).toBe(false);
    expect(isHelpModeContext(undefined)).toBe(false);
  });

  it("false for help without colon (just the word)", () => {
    expect(isHelpModeContext("help")).toBe(false);
  });
});

describe("helpModeContextSlice (s137 t532 Phase 1)", () => {
  it("extracts the page-context portion", () => {
    expect(helpModeContextSlice("help:projects browser")).toBe("projects browser");
    expect(helpModeContextSlice("help:")).toBe("");
  });

  it("null for non-help-mode contexts", () => {
    expect(helpModeContextSlice("global")).toBeNull();
    expect(helpModeContextSlice(null)).toBeNull();
  });
});

describe("HELP_MODE_TOOL_ALLOWLIST (s137 t532 Phase 1)", () => {
  it("includes the canonical read-only tools", () => {
    expect(HELP_MODE_TOOL_ALLOWLIST.has("lookup_knowledge")).toBe(true);
    expect(HELP_MODE_TOOL_ALLOWLIST.has("notes")).toBe(true);
    expect(HELP_MODE_TOOL_ALLOWLIST.has("agi_status")).toBe(true);
    expect(HELP_MODE_TOOL_ALLOWLIST.has("mcp")).toBe(true);
  });

  it("does NOT include mutating tools", () => {
    expect(HELP_MODE_TOOL_ALLOWLIST.has("bash")).toBe(false);
    expect(HELP_MODE_TOOL_ALLOWLIST.has("file_write")).toBe(false);
    expect(HELP_MODE_TOOL_ALLOWLIST.has("git_commit")).toBe(false);
  });
  // Note: Object.freeze on a Set doesn't freeze its mutation methods —
  // mutability protection comes from the ReadonlySet type, not runtime.
});

describe("HELP_MODE_TOOL_DENYLIST (s137 t532 Phase 1)", () => {
  it("includes mutating + recursive tools", () => {
    expect(HELP_MODE_TOOL_DENYLIST.has("bash")).toBe(true);
    expect(HELP_MODE_TOOL_DENYLIST.has("file_write")).toBe(true);
    expect(HELP_MODE_TOOL_DENYLIST.has("taskmaster_dispatch")).toBe(true);
    expect(HELP_MODE_TOOL_DENYLIST.has("git_commit")).toBe(true);
  });

  it("does not collide with allowlist", () => {
    for (const allowed of HELP_MODE_TOOL_ALLOWLIST) {
      expect(HELP_MODE_TOOL_DENYLIST.has(allowed)).toBe(false);
    }
  });
});

describe("helpModeFiltersTool (s137 t532 Phase 1)", () => {
  it("returns false for allowlisted tools", () => {
    expect(helpModeFiltersTool("lookup_knowledge")).toBe(false);
    expect(helpModeFiltersTool("notes")).toBe(false);
    expect(helpModeFiltersTool("mcp")).toBe(false);
  });

  it("returns true for explicitly-denylisted tools", () => {
    expect(helpModeFiltersTool("bash")).toBe(true);
    expect(helpModeFiltersTool("git_commit")).toBe(true);
    expect(helpModeFiltersTool("taskmaster_dispatch")).toBe(true);
  });

  it("returns true for tools that are neither allowed nor denied (default-deny)", () => {
    expect(helpModeFiltersTool("some_unknown_tool")).toBe(true);
    expect(helpModeFiltersTool("createTask")).toBe(true);
  });
});
