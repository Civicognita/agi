import { describe, it, expect, afterEach, vi } from "vitest";
import { listPrComments, postPrComment, mapIssueComment } from "./dev-mode-incoming.js";
import { CORE_REPOS } from "./dev-mode-forks.js";

/** Wave 2c — PR comment read/post mapping + request shape. */
const spec = CORE_REPOS[0]!;

describe("PR comments", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mapIssueComment maps GitHub fields (with fallbacks)", () => {
    expect(mapIssueComment({ id: 7, user: { login: "alice", avatar_url: "http://a" }, body: "hi", created_at: "2026-01-01T00:00:00Z", html_url: "http://x" })).toEqual({
      id: 7, authorLogin: "alice", authorAvatar: "http://a", body: "hi", createdAt: "2026-01-01T00:00:00Z", htmlUrl: "http://x",
    });
    expect(mapIssueComment({ id: 8 })).toEqual({ id: 8, authorLogin: "unknown", authorAvatar: null, body: "", createdAt: "", htmlUrl: "" });
  });

  it("listPrComments hits issues/<n>/comments and maps the result", async () => {
    let calledUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      calledUrl = String(url);
      return new Response(JSON.stringify([{ id: 1, user: { login: "bob" }, body: "lgtm", created_at: "t", html_url: "u" }]), { status: 200 });
    }));
    const out = await listPrComments(spec, 42, "tok");
    expect(calledUrl).toContain("/issues/42/comments");
    expect(out).toHaveLength(1);
    expect(out[0]?.authorLogin).toBe("bob");
  });

  it("postPrComment POSTs the body and returns the created comment", async () => {
    let method = "";
    let sentBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
      method = init?.method ?? "GET";
      sentBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: 9, user: { login: "me" }, body: "thanks", created_at: "t", html_url: "u" }), { status: 201 });
    }));
    const c = await postPrComment(spec, 42, "tok", "thanks");
    expect(method).toBe("POST");
    expect(sentBody).toContain("thanks");
    expect(c.id).toBe(9);
  });

  it("listPrComments throws on a GitHub error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 404 })));
    await expect(listPrComments(spec, 1, "tok")).rejects.toThrow(/404/);
  });
});
