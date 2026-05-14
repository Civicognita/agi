/**
 * PendingApprovalStore tests (CHN-E s166 slice 1).
 */
import { describe, it, expect, beforeEach } from "vitest";
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
