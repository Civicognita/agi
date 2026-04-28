import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AnchorRecord } from "@agi/sdk";
import { NoopAnchor } from "./noop.js";

let workDir: string;
let logPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "noop-anchor-test-"));
  logPath = join(workDir, "anchors", "pending.jsonl");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeRecord(overrides: Partial<AnchorRecord> = {}): AnchorRecord {
  return {
    hash: "sha256:abc123",
    owner: "#E0",
    timestamp: "2026-04-25T22:00:00.000Z",
    provenance: { source: "test" },
    ...overrides,
  };
}

describe("NoopAnchor — basic anchor + verify (s112 t383)", () => {
  it("creates the parent directory on construction", () => {
    new NoopAnchor({ logPath });
    expect(existsSync(join(workDir, "anchors"))).toBe(true);
  });

  it("anchor() returns a deterministic noop:<hex> txHash", async () => {
    const anchor = new NoopAnchor({ logPath });
    const result = await anchor.anchor(makeRecord());
    expect(result.txHash).toMatch(/^noop:[0-9a-f]{24}$/);
    expect(result.cid).toBeUndefined();
  });

  it("same record produces the same txHash (deterministic)", async () => {
    const anchor = new NoopAnchor({ logPath });
    const r1 = await anchor.anchor(makeRecord());
    const r2 = await anchor.anchor(makeRecord());
    expect(r1.txHash).toBe(r2.txHash);
  });

  it("different records produce different txHashes", async () => {
    const anchor = new NoopAnchor({ logPath });
    const r1 = await anchor.anchor(makeRecord({ hash: "sha256:aaa" }));
    const r2 = await anchor.anchor(makeRecord({ hash: "sha256:bbb" }));
    expect(r1.txHash).not.toBe(r2.txHash);
  });

  it("anchor() persists to the configured log path", async () => {
    const anchor = new NoopAnchor({ logPath });
    await anchor.anchor(makeRecord());
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.record.hash).toBe("sha256:abc123");
    expect(parsed.txHash).toMatch(/^noop:/);
  });

  it("verify() returns exists:true + the original record by hash", async () => {
    const anchor = new NoopAnchor({ logPath });
    const record = makeRecord();
    await anchor.anchor(record);
    const result = await anchor.verify(record.hash);
    expect(result.exists).toBe(true);
    expect(result.record).toEqual(record);
  });

  it("verify() returns exists:false for unknown hash", async () => {
    const anchor = new NoopAnchor({ logPath });
    await anchor.anchor(makeRecord({ hash: "sha256:known" }));
    const result = await anchor.verify("sha256:unknown");
    expect(result.exists).toBe(false);
    expect(result.record).toBeUndefined();
  });

  it("verify() returns exists:false when the log doesn't exist yet", async () => {
    const anchor = new NoopAnchor({ logPath });
    const result = await anchor.verify("sha256:anything");
    expect(result.exists).toBe(false);
  });
});

describe("NoopAnchor — listByOwner pagination + sort", () => {
  it("returns records for a specific owner only", async () => {
    const anchor = new NoopAnchor({ logPath });
    await anchor.anchor(makeRecord({ owner: "#E0", hash: "sha256:1" }));
    await anchor.anchor(makeRecord({ owner: "#E1", hash: "sha256:2" }));
    await anchor.anchor(makeRecord({ owner: "#E0", hash: "sha256:3" }));
    const e0 = await anchor.listByOwner("#E0");
    expect(e0.map((r) => r.hash).sort()).toEqual(["sha256:1", "sha256:3"]);
    const e1 = await anchor.listByOwner("#E1");
    expect(e1.map((r) => r.hash)).toEqual(["sha256:2"]);
  });

  it("returns newest-first by timestamp", async () => {
    const anchor = new NoopAnchor({ logPath });
    await anchor.anchor(makeRecord({ hash: "sha256:older", timestamp: "2026-04-20T00:00:00.000Z" }));
    await anchor.anchor(makeRecord({ hash: "sha256:newest", timestamp: "2026-04-26T00:00:00.000Z" }));
    await anchor.anchor(makeRecord({ hash: "sha256:middle", timestamp: "2026-04-23T00:00:00.000Z" }));
    const records = await anchor.listByOwner("#E0");
    expect(records.map((r) => r.hash)).toEqual(["sha256:newest", "sha256:middle", "sha256:older"]);
  });

  it("respects the limit parameter (default 100)", async () => {
    const anchor = new NoopAnchor({ logPath });
    for (let i = 0; i < 5; i++) {
      await anchor.anchor(makeRecord({ hash: `sha256:${i}` }));
    }
    const limited = await anchor.listByOwner("#E0", 2);
    expect(limited).toHaveLength(2);
  });

  it("returns empty array when log doesn't exist", async () => {
    const anchor = new NoopAnchor({ logPath });
    const records = await anchor.listByOwner("#E0");
    expect(records).toEqual([]);
  });
});

describe("NoopAnchor — anchor record carries optional fields", () => {
  it("preserves evalScore when set (adapter promotion case)", async () => {
    const anchor = new NoopAnchor({ logPath });
    const record = makeRecord({
      hash: "sha256:adapter-v2",
      provenance: { source: "lora-train", modelVersion: "aion-micro-v1" },
      evalScore: 0.87,
    });
    await anchor.anchor(record);
    const result = await anchor.verify("sha256:adapter-v2");
    expect(result.record?.evalScore).toBe(0.87);
    expect(result.record?.provenance.modelVersion).toBe("aion-micro-v1");
  });

  it("preserves governanceApproval when set", async () => {
    const anchor = new NoopAnchor({ logPath });
    const record = makeRecord({
      hash: "sha256:promotion-1",
      governanceApproval: { approver: "#E0", signedAt: "2026-04-25T22:30:00.000Z" },
    });
    await anchor.anchor(record);
    const result = await anchor.verify("sha256:promotion-1");
    expect(result.record?.governanceApproval?.approver).toBe("#E0");
  });
});
