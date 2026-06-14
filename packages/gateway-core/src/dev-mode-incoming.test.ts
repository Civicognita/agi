import { afterEach, describe, expect, it, vi } from "vitest";

import { mapPullToIncoming, listIncomingPrs } from "./dev-mode-incoming.js";
import { CORE_REPOS } from "./dev-mode-forks.js";

/**
 * dev-mode-incoming — the INBOUND review queue. The owner is the First Custodian
 * of Upstream (Civicognita/agi); contributors PR their personal forks INTO
 * upstream `dev`. This lists those open PRs so the owner can review + test them
 * before merging. Mirror of dev-mode-contribute (outbound).
 */
describe("dev-mode-incoming", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const agiSpec = CORE_REPOS.find((s) => s.slug === "agi")!;

  it("mapPullToIncoming flattens a GitHub PR into IncomingPrInfo", () => {
    const pull = {
      number: 178,
      title: "Genie integration",
      user: { login: "alice" },
      head: { ref: "feat/genie", sha: "abc1234", repo: { full_name: "alice/agi" } },
      base: { ref: "dev" },
      html_url: "https://github.com/Civicognita/agi/pull/178",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-02T00:00:00Z",
      draft: false,
    };
    const info = mapPullToIncoming(pull, "agi");
    expect(info.number).toBe(178);
    expect(info.title).toBe("Genie integration");
    expect(info.authorLogin).toBe("alice");
    expect(info.headRepoFullName).toBe("alice/agi");
    expect(info.headRef).toBe("feat/genie");
    expect(info.headSha).toBe("abc1234");
    expect(info.baseRef).toBe("dev");
    expect(info.htmlUrl).toBe("https://github.com/Civicognita/agi/pull/178");
    expect(info.isDraft).toBe(false);
    // upstream repo for slug "agi" is Civicognita/agi → alice/agi is cross-repo.
    expect(info.isCrossRepo).toBe(true);
  });

  it("flags a same-repo (branch) PR as NOT cross-repo", () => {
    const pull = {
      number: 9,
      title: "hotfix on upstream branch",
      user: { login: "wishborn" },
      head: { ref: "hotfix", sha: "deadbee", repo: { full_name: "Civicognita/agi" } },
      base: { ref: "dev" },
      html_url: "https://github.com/Civicognita/agi/pull/9",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
      draft: false,
    };
    expect(mapPullToIncoming(pull, "agi").isCrossRepo).toBe(false);
  });

  it("tolerates a deleted head repo (fork removed after PR)", () => {
    const pull = {
      number: 5,
      title: "orphaned",
      user: { login: "ghost" },
      head: { ref: "x", sha: "f00", repo: null },
      base: { ref: "dev" },
      html_url: "u",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    };
    const info = mapPullToIncoming(pull, "agi");
    expect(info.headRepoFullName).toBe("(deleted fork)");
    expect(info.isCrossRepo).toBe(true);
    expect(info.isDraft).toBe(false); // missing draft → false
  });

  it("listIncomingPrs queries upstream pulls?base=dev&state=open and maps them", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        json: async () => [
          {
            number: 178, title: "PR", user: { login: "alice" },
            head: { ref: "f", sha: "s", repo: { full_name: "alice/agi" } },
            base: { ref: "dev" }, html_url: "u",
            created_at: "t", updated_at: "t", draft: false,
          },
        ],
      }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const prs = await listIncomingPrs(agiSpec, "tok");
    expect(prs).toHaveLength(1);
    expect(prs[0]!.number).toBe(178);

    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("/repos/Civicognita/agi/pulls");
    expect(calledUrl).toContain("base=dev");
    expect(calledUrl).toContain("state=open");
  });

  it("listIncomingPrs returns [] on a GitHub error (best-effort, non-fatal)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response));
    expect(await listIncomingPrs(agiSpec, "tok")).toEqual([]);
  });
});
