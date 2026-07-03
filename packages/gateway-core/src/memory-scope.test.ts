/**
 * memory-scope tests — s234 t793. Pure logic: grammar round-trips, parsing
 * (incl. ':' inside roomId/projectPath), recall scope-stack resolution,
 * write-scope selection, and the prime read-only guard.
 */

import { describe, it, expect } from "vitest";
import {
  SCOPE_PRIME,
  SCOPE_GESTALT,
  projectScope,
  providerScope,
  roomScope,
  parseScope,
  scopeLayer,
  resolveScopeStack,
  resolveWriteScope,
  isReadOnlyScope,
  memoryCategoryForScope,
  scopeAtLayer,
  resolveWriteScopeWithPolicy,
} from "./memory-scope.js";

describe("memory-scope — constructors + parsing", () => {
  it("round-trips project scope (path may contain slashes)", () => {
    const s = projectScope("/home/wishborn/_projects/foo");
    expect(s).toBe("project:/home/wishborn/_projects/foo");
    expect(parseScope(s)).toEqual({
      layer: "project",
      projectPath: "/home/wishborn/_projects/foo",
    });
  });

  it("round-trips provider scope", () => {
    const s = providerScope("discord");
    expect(s).toBe("provider:discord");
    expect(parseScope(s)).toEqual({ layer: "provider", channelId: "discord" });
  });

  it("round-trips room scope and preserves a roomId containing ':'", () => {
    const s = roomScope("discord", "guild-1:channel-x");
    expect(s).toBe("room:discord:guild-1:channel-x");
    expect(parseScope(s)).toEqual({
      layer: "room",
      channelId: "discord",
      roomId: "guild-1:channel-x",
    });
  });

  it("parses a DM-style roomId", () => {
    expect(parseScope(roomScope("discord", "@alice"))).toEqual({
      layer: "room",
      channelId: "discord",
      roomId: "@alice",
    });
  });

  it("classifies the bare layers", () => {
    expect(scopeLayer(SCOPE_PRIME)).toBe("prime");
    expect(scopeLayer(SCOPE_GESTALT)).toBe("gestalt");
  });

  it("throws on an unknown prefix or malformed room scope", () => {
    expect(() => parseScope("bogus")).toThrow();
    expect(() => parseScope("nonsense:x")).toThrow();
    expect(() => parseScope("room:discord")).toThrow(/roomId/);
  });
});

describe("memory-scope — resolveScopeStack (recall)", () => {
  it("Discord room in a bound project: room → provider → project → gestalt → prime", () => {
    expect(
      resolveScopeStack({
        channelId: "discord",
        roomId: "guild-1:bugs",
        projectPath: "/p/j",
      }),
    ).toEqual([
      "room:discord:guild-1:bugs",
      "provider:discord",
      "project:/p/j",
      SCOPE_GESTALT,
      SCOPE_PRIME,
    ]);
  });

  it("project chat (no channel): project → gestalt → prime", () => {
    expect(resolveScopeStack({ projectPath: "/p/j" })).toEqual([
      "project:/p/j",
      SCOPE_GESTALT,
      SCOPE_PRIME,
    ]);
  });

  it("bare chat: gestalt → prime", () => {
    expect(resolveScopeStack({})).toEqual([SCOPE_GESTALT, SCOPE_PRIME]);
  });

  it("provider present but no room: provider → gestalt → prime (no room layer)", () => {
    expect(resolveScopeStack({ channelId: "discord" })).toEqual([
      "provider:discord",
      SCOPE_GESTALT,
      SCOPE_PRIME,
    ]);
  });

  it("CONFINEMENT: a room's scope is absent from another room's stack", () => {
    const stackR2 = resolveScopeStack({ channelId: "discord", roomId: "general" });
    expect(stackR2).not.toContain("room:discord:secret-dm");
  });

  it("CASCADE: gestalt is visible from every context", () => {
    expect(resolveScopeStack({ channelId: "discord", roomId: "r" })).toContain(SCOPE_GESTALT);
    expect(resolveScopeStack({ projectPath: "/p" })).toContain(SCOPE_GESTALT);
    expect(resolveScopeStack({})).toContain(SCOPE_GESTALT);
  });

  it("treats null/undefined context fields the same (no empty layers)", () => {
    expect(resolveScopeStack({ channelId: null, roomId: null, projectPath: null })).toEqual([
      SCOPE_GESTALT,
      SCOPE_PRIME,
    ]);
  });
});

describe("memory-scope — resolveWriteScope (capture)", () => {
  it("channel turn confines to its room", () => {
    expect(resolveWriteScope({ channelId: "discord", roomId: "guild-1:bugs", projectPath: "/p/j" }))
      .toBe("room:discord:guild-1:bugs");
  });

  it("provider with no room writes at provider scope", () => {
    expect(resolveWriteScope({ channelId: "discord" })).toBe("provider:discord");
  });

  it("project chat writes at project scope", () => {
    expect(resolveWriteScope({ projectPath: "/p/j" })).toBe("project:/p/j");
  });

  it("bare chat falls to the gestalt floor", () => {
    expect(resolveWriteScope({})).toBe(SCOPE_GESTALT);
  });

  it("NEVER returns prime", () => {
    for (const ctx of [
      { channelId: "discord", roomId: "r", projectPath: "/p" },
      { projectPath: "/p" },
      {},
    ]) {
      expect(resolveWriteScope(ctx)).not.toBe(SCOPE_PRIME);
    }
  });
});

describe("memory-scope — read-only guard", () => {
  it("only prime is read-only", () => {
    expect(isReadOnlyScope(SCOPE_PRIME)).toBe(true);
    expect(isReadOnlyScope(SCOPE_GESTALT)).toBe(false);
    expect(isReadOnlyScope(projectScope("/p"))).toBe(false);
    expect(isReadOnlyScope(roomScope("discord", "r"))).toBe(false);
  });
});

describe("memory-scope — memoryCategoryForScope (prompt labels)", () => {
  it("maps each layer to its injection category", () => {
    expect(memoryCategoryForScope(roomScope("discord", "r"))).toBe("room-memory");
    expect(memoryCategoryForScope(providerScope("discord"))).toBe("channel-memory");
    expect(memoryCategoryForScope(projectScope("/p"))).toBe("project-memory");
    expect(memoryCategoryForScope(SCOPE_GESTALT)).toBe("memory");
    expect(memoryCategoryForScope(SCOPE_PRIME)).toBe("memory");
  });

  it("falls back to 'memory' for null/legacy/unparseable scopes", () => {
    expect(memoryCategoryForScope(null)).toBe("memory");
    expect(memoryCategoryForScope(undefined)).toBe("memory");
    expect(memoryCategoryForScope("global")).toBe("memory"); // pre-s234 legacy value
  });
});

describe("memory-scope — cascade-up policy (owner promotion)", () => {
  const roomCtx = { channelId: "discord", roomId: "guild-1:bugs", projectPath: "/p/j" };

  it("default (no policy) keeps every memory confined", () => {
    expect(resolveWriteScopeWithPolicy(roomCtx)).toBe("room:discord:guild-1:bugs");
    expect(resolveWriteScopeWithPolicy({ projectPath: "/p/j" })).toBe("project:/p/j");
    expect(resolveWriteScopeWithPolicy({})).toBe("gestalt");
  });

  it("promotes a room memory up to provider", () => {
    expect(resolveWriteScopeWithPolicy(roomCtx, { room: { reachUpTo: "provider" } }))
      .toBe("provider:discord");
  });

  it("promotes a room memory all the way to gestalt", () => {
    expect(resolveWriteScopeWithPolicy(roomCtx, { room: { reachUpTo: "gestalt" } }))
      .toBe("gestalt");
  });

  it("promotes a provider memory to gestalt", () => {
    expect(resolveWriteScopeWithPolicy({ channelId: "discord" }, { provider: { reachUpTo: "gestalt" } }))
      .toBe("gestalt");
  });

  it("promotes a project memory to gestalt", () => {
    expect(resolveWriteScopeWithPolicy({ projectPath: "/p/j" }, { project: { reachUpTo: "gestalt" } }))
      .toBe("gestalt");
  });

  it("ignores a ceiling that is not strictly broader than the base", () => {
    // provider rule doesn't apply to a room-scoped base; room→room is a no-op.
    expect(resolveWriteScopeWithPolicy(roomCtx, { provider: { reachUpTo: "gestalt" } }))
      .toBe("room:discord:guild-1:bugs");
  });

  it("falls back to the base scope when the ceiling layer is unavailable in context", () => {
    // room memory told to reach up to project, but there is no projectPath.
    expect(resolveWriteScopeWithPolicy({ channelId: "discord", roomId: "r" }, { room: { reachUpTo: "project" } }))
      .toBe("room:discord:r");
  });

  it("scopeAtLayer reconstructs scopes from context", () => {
    expect(scopeAtLayer(roomCtx, "room")).toBe("room:discord:guild-1:bugs");
    expect(scopeAtLayer(roomCtx, "provider")).toBe("provider:discord");
    expect(scopeAtLayer(roomCtx, "project")).toBe("project:/p/j");
    expect(scopeAtLayer(roomCtx, "gestalt")).toBe("gestalt");
    expect(scopeAtLayer(roomCtx, "prime")).toBeNull();
    expect(scopeAtLayer({}, "provider")).toBeNull();
  });
});
