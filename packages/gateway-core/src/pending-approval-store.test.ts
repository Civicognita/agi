/**
 * PendingApprovalStore tests (CHN-E s166 slice 1 + slice 7 persistence).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PendingApprovalStore, pendingApprovalId } from "./pending-approval-store.js";

describe("pendingApprovalId", () => {
  it("encodes the triple as `channelId::roomId::channelUserId`", () => {
    expect(pendingApprovalId("discord", "guild-1:channel-x", "user-42")).toBe(
      "discord::guild-1:channel-x::user-42",
    );
  });

  it("is stable across calls (same input → same id)", () => {
    expect(pendingApprovalId("d", "r", "u")).toBe(pendingApprovalId("d", "r", "u"));
  });
});

describe("PendingApprovalStore — capture + list", () => {
  let store: PendingApprovalStore;

  beforeEach(() => {
    store = new PendingApprovalStore();
  });

  it("captures a new pending approval", () => {
    const approval = store.capture({
      channelId: "discord",
      roomId: "guild-1:channel-x",
      channelUserId: "alice",
      displayName: "Alice",
      projectPath: "/home/user/projects/my-app",
      firstMessagePreview: "Hello, anyone there?",
    });
    expect(approval.id).toBe("discord::guild-1:channel-x::alice");
    expect(approval.displayName).toBe("Alice");
    expect(approval.firstMessagePreview).toBe("Hello, anyone there?");
    expect(approval.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("truncates firstMessagePreview to 200 chars", () => {
    const long = "x".repeat(500);
    const approval = store.capture({
      channelId: "discord",
      roomId: "r",
      channelUserId: "u",
      displayName: "U",
      projectPath: "/p",
      firstMessagePreview: long,
    });
    expect(approval.firstMessagePreview.length).toBe(200);
  });

  it("is idempotent: same triple updates display/preview, keeps id + createdAt", async () => {
    const first = store.capture({
      channelId: "discord",
      roomId: "r",
      channelUserId: "u",
      displayName: "Original",
      projectPath: "/p",
      firstMessagePreview: "first",
    });
    // Small delay to ensure clock movement (though id stability shouldn't depend on it)
    await new Promise((r) => setTimeout(r, 5));
    const second = store.capture({
      channelId: "discord",
      roomId: "r",
      channelUserId: "u",
      displayName: "Updated",
      projectPath: "/p",
      firstMessagePreview: "second",
    });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.displayName).toBe("Updated");
    expect(second.firstMessagePreview).toBe("second");
    expect(store.list()).toHaveLength(1);
  });

  it("different triples produce different entries", () => {
    store.capture({ channelId: "discord", roomId: "r1", channelUserId: "u", displayName: "U", projectPath: "/p", firstMessagePreview: "" });
    store.capture({ channelId: "discord", roomId: "r2", channelUserId: "u", displayName: "U", projectPath: "/p", firstMessagePreview: "" });
    store.capture({ channelId: "telegram", roomId: "r1", channelUserId: "u", displayName: "U", projectPath: "/p", firstMessagePreview: "" });
    expect(store.list()).toHaveLength(3);
  });

  it("list returns approvals oldest-first by createdAt", async () => {
    store.capture({ channelId: "d", roomId: "r1", channelUserId: "u1", displayName: "First", projectPath: "/p", firstMessagePreview: "" });
    await new Promise((r) => setTimeout(r, 10));
    store.capture({ channelId: "d", roomId: "r2", channelUserId: "u2", displayName: "Second", projectPath: "/p", firstMessagePreview: "" });
    const all = store.list();
    expect(all[0]?.displayName).toBe("First");
    expect(all[1]?.displayName).toBe("Second");
  });

  it("listForProject filters by projectPath", () => {
    store.capture({ channelId: "d", roomId: "r", channelUserId: "u1", displayName: "A", projectPath: "/proj-1", firstMessagePreview: "" });
    store.capture({ channelId: "d", roomId: "r", channelUserId: "u2", displayName: "B", projectPath: "/proj-2", firstMessagePreview: "" });
    store.capture({ channelId: "d", roomId: "r", channelUserId: "u3", displayName: "C", projectPath: "/proj-1", firstMessagePreview: "" });
    expect(store.listForProject("/proj-1")).toHaveLength(2);
    expect(store.listForProject("/proj-2")).toHaveLength(1);
    expect(store.listForProject("/proj-unknown")).toHaveLength(0);
  });

  it("get returns null for unknown id", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  it("get returns the captured approval by id", () => {
    const approval = store.capture({
      channelId: "d", roomId: "r", channelUserId: "u", displayName: "U", projectPath: "/p", firstMessagePreview: "",
    });
    expect(store.get(approval.id)).toEqual(approval);
  });
});

describe("PendingApprovalStore — approve/reject", () => {
  let store: PendingApprovalStore;

  beforeEach(() => {
    store = new PendingApprovalStore();
    store.capture({
      channelId: "discord", roomId: "guild-1:channel-x", channelUserId: "alice",
      displayName: "Alice", projectPath: "/home/p", firstMessagePreview: "hi",
    });
  });

  it("approve removes from pending + records decision", () => {
    const id = "discord::guild-1:channel-x::alice";
    const { approval, decision } = store.approve(id);
    expect(approval.displayName).toBe("Alice");
    expect(decision.status).toBe("approved");
    expect(store.list()).toHaveLength(0);
    expect(store.get(id)).toBeNull();
  });

  it("reject removes from pending + records decision", () => {
    const id = "discord::guild-1:channel-x::alice";
    const { approval, decision } = store.reject(id);
    expect(approval.displayName).toBe("Alice");
    expect(decision.status).toBe("rejected");
    expect(store.list()).toHaveLength(0);
    expect(store.get(id)).toBeNull();
  });

  it("approve throws when id not found", () => {
    expect(() => store.approve("nonexistent")).toThrow(/not found/);
  });

  it("reject throws when id not found", () => {
    expect(() => store.reject("nonexistent")).toThrow(/not found/);
  });

  it("decisionFor returns the recorded decision after approve", () => {
    store.approve("discord::guild-1:channel-x::alice");
    const decision = store.decisionFor("discord", "guild-1:channel-x", "alice");
    expect(decision?.status).toBe("approved");
  });

  it("decisionFor returns the recorded decision after reject", () => {
    store.reject("discord::guild-1:channel-x::alice");
    const decision = store.decisionFor("discord", "guild-1:channel-x", "alice");
    expect(decision?.status).toBe("rejected");
  });

  it("decisionFor returns null when no decision recorded", () => {
    expect(store.decisionFor("discord", "guild-1:channel-x", "bob")).toBeNull();
  });
});

describe("PendingApprovalStore — persistence (slice 7)", () => {
  let tmpDir: string;
  let persistPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pas-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    persistPath = join(tmpDir, "pending-approvals.json");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it("creates the persist file on first capture", () => {
    const store = new PendingApprovalStore({ persistPath });
    expect(existsSync(persistPath)).toBe(false);
    store.capture({
      channelId: "discord", roomId: "r", channelUserId: "u",
      displayName: "U", projectPath: "/p", firstMessagePreview: "hi",
    });
    expect(existsSync(persistPath)).toBe(true);
  });

  it("loads pending approvals from disk into a fresh store", () => {
    const a = new PendingApprovalStore({ persistPath });
    a.capture({
      channelId: "discord", roomId: "r1", channelUserId: "u1",
      displayName: "Alice", projectPath: "/proj", firstMessagePreview: "first",
    });
    a.capture({
      channelId: "telegram", roomId: "r2", channelUserId: "u2",
      displayName: "Bob", projectPath: "/proj", firstMessagePreview: "second",
    });
    // New store reads the same file
    const b = new PendingApprovalStore({ persistPath });
    expect(b.list()).toHaveLength(2);
    const fromB = b.get("discord::r1::u1");
    expect(fromB?.displayName).toBe("Alice");
  });

  it("persists approve/reject decisions across instances", () => {
    const a = new PendingApprovalStore({ persistPath });
    const approval = a.capture({
      channelId: "discord", roomId: "r", channelUserId: "u",
      displayName: "U", projectPath: "/p", firstMessagePreview: "",
    });
    a.approve(approval.id);
    // Re-open
    const b = new PendingApprovalStore({ persistPath });
    expect(b.list()).toHaveLength(0); // approved → removed from pending
    expect(b.decisionFor("discord", "r", "u")?.status).toBe("approved");
  });

  it("survives a reject across instances", () => {
    const a = new PendingApprovalStore({ persistPath });
    const approval = a.capture({
      channelId: "discord", roomId: "r", channelUserId: "u",
      displayName: "U", projectPath: "/p", firstMessagePreview: "",
    });
    a.reject(approval.id);
    const b = new PendingApprovalStore({ persistPath });
    expect(b.decisionFor("discord", "r", "u")?.status).toBe("rejected");
  });

  it("write produces valid JSON with both arrays", () => {
    const store = new PendingApprovalStore({ persistPath });
    const approval = store.capture({
      channelId: "discord", roomId: "r", channelUserId: "u",
      displayName: "U", projectPath: "/p", firstMessagePreview: "",
    });
    store.approve(approval.id);
    const raw = readFileSync(persistPath, "utf-8");
    const parsed = JSON.parse(raw) as { approvals: unknown[]; decisions: unknown[] };
    expect(Array.isArray(parsed.approvals)).toBe(true);
    expect(Array.isArray(parsed.decisions)).toBe(true);
    expect(parsed.approvals).toHaveLength(0);
    expect(parsed.decisions).toHaveLength(1);
  });

  it("silently starts empty when the persist file doesn't exist", () => {
    expect(existsSync(persistPath)).toBe(false);
    const store = new PendingApprovalStore({ persistPath });
    expect(store.list()).toEqual([]);
  });

  it("in-memory mode (no persistPath) doesn't write any file", () => {
    const store = new PendingApprovalStore(); // no persistPath
    store.capture({
      channelId: "discord", roomId: "r", channelUserId: "u",
      displayName: "U", projectPath: "/p", firstMessagePreview: "",
    });
    expect(existsSync(persistPath)).toBe(false);
  });
});
