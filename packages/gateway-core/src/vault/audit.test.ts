import { describe, it, expect, beforeEach } from "vitest";
import type { COAChainLogger } from "@agi/coa-chain";
import { VaultAuditor, hashAuditPayload } from "./audit.js";

interface MockLogParams {
  resourceId: string;
  entityId: string;
  entityAlias?: string;
  nodeId: string;
  workType: string;
  ref?: string;
  action?: string;
  payloadHash?: string;
}

function createMockLogger(opts: { throwOnLog?: boolean } = {}): {
  logger: COAChainLogger;
  calls: MockLogParams[];
} {
  const calls: MockLogParams[] = [];
  const logger = {
    log: async (params: MockLogParams): Promise<string> => {
      if (opts.throwOnLog === true) throw new Error("simulated logger failure");
      calls.push(params);
      return `fake-fingerprint-${String(calls.length)}`;
    },
  } as unknown as COAChainLogger;
  return { logger, calls };
}

describe("VaultAuditor (s128 t498)", () => {
  describe("hashAuditPayload", () => {
    it("returns a deterministic SHA-256 hex digest for the same input", () => {
      const a = hashAuditPayload("01H7XYZ", "/home/wishborn/projects/sample-go");
      const b = hashAuditPayload("01H7XYZ", "/home/wishborn/projects/sample-go");
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it("varies by entry id", () => {
      const a = hashAuditPayload("01H7XYZ");
      const b = hashAuditPayload("01H7ABC");
      expect(a).not.toBe(b);
    });

    it("varies by requestingProject", () => {
      const a = hashAuditPayload("01H7XYZ", "/home/projects/a");
      const b = hashAuditPayload("01H7XYZ", "/home/projects/b");
      expect(a).not.toBe(b);
    });

    it("undefined requestingProject is distinct from a path string", () => {
      const a = hashAuditPayload("01H7XYZ");
      const b = hashAuditPayload("01H7XYZ", "/home/wishborn/projects/sample-go");
      expect(a).not.toBe(b);
    });

    it("undefined requestingProject hashes to the gateway-scoped slot", () => {
      const a = hashAuditPayload("01H7XYZ");
      const b = hashAuditPayload("01H7XYZ", undefined);
      expect(a).toBe(b);
    });
  });

  describe("recordRead", () => {
    let mock: ReturnType<typeof createMockLogger>;
    let auditor: VaultAuditor;

    beforeEach(() => {
      mock = createMockLogger();
      auditor = new VaultAuditor(mock.logger);
    });

    it("logs a vault_read entry with the canonical fields", async () => {
      const fp = await auditor.recordRead({
        entryId: "01H7XYZ",
        requestingProject: "/home/wishborn/projects/sample-go",
        entityId: "ent-123",
        entityAlias: "$A0",
        resourceId: "$AGI",
        nodeId: "@A0",
      });

      expect(fp).toBe("fake-fingerprint-1");
      expect(mock.calls).toHaveLength(1);
      const call = mock.calls[0]!;
      expect(call.workType).toBe("vault_read");
      expect(call.ref).toBe("01H7XYZ");
      expect(call.entityId).toBe("ent-123");
      expect(call.entityAlias).toBe("$A0");
      expect(call.resourceId).toBe("$AGI");
      expect(call.nodeId).toBe("@A0");
      expect(call.action).toBe("create");
      // payloadHash is the SHA-256 of `<id>|<project>`
      expect(call.payloadHash).toBe(hashAuditPayload("01H7XYZ", "/home/wishborn/projects/sample-go"));
    });

    it("omits entityAlias when not supplied", async () => {
      await auditor.recordRead({
        entryId: "01H7XYZ",
        entityId: "ent-123",
        resourceId: "$AGI",
        nodeId: "@A0",
      });
      const call = mock.calls[0]!;
      expect(call.entityAlias).toBeUndefined();
    });

    it("hashes gateway-scoped reads (no requestingProject) into the canonical slot", async () => {
      await auditor.recordRead({
        entryId: "01H7XYZ",
        entityId: "ent-123",
        resourceId: "$AGI",
        nodeId: "@A0",
      });
      const call = mock.calls[0]!;
      expect(call.payloadHash).toBe(hashAuditPayload("01H7XYZ"));
    });

    it("returns null and swallows logger failures (audit must not block reads)", async () => {
      const failing = createMockLogger({ throwOnLog: true });
      const failingAuditor = new VaultAuditor(failing.logger);
      const fp = await failingAuditor.recordRead({
        entryId: "01H7XYZ",
        entityId: "ent-123",
        resourceId: "$AGI",
        nodeId: "@A0",
      });
      expect(fp).toBeNull();
    });

    it("multiple reads produce distinct fingerprints (logger increments counter)", async () => {
      const fp1 = await auditor.recordRead({
        entryId: "01H7XYZ",
        entityId: "e",
        resourceId: "r",
        nodeId: "n",
      });
      const fp2 = await auditor.recordRead({
        entryId: "01H7ABC",
        entityId: "e",
        resourceId: "r",
        nodeId: "n",
      });
      expect(fp1).toBe("fake-fingerprint-1");
      expect(fp2).toBe("fake-fingerprint-2");
      expect(mock.calls).toHaveLength(2);
    });
  });
});
