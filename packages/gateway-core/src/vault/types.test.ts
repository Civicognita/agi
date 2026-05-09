import { describe, it, expect } from "vitest";
import {
  parseVaultEntry,
  summarizeVaultEntry,
  isVaultReference,
  extractVaultReferenceId,
  VAULT_ENTRY_TYPES,
  VAULT_REFERENCE_PREFIX,
  VaultEntryParseError,
  type VaultEntry,
} from "./types.js";

describe("vault/types — schema validation (s128 t492)", () => {
  describe("parseVaultEntry", () => {
    const validBlob = {
      id: "01H7XYZ",
      name: "Tynn API key",
      type: "key",
      created: "2026-04-28T12:00:00.000Z",
      lastAccessed: null,
      owningProject: null,
    };

    it("parses a minimal valid blob", () => {
      const entry = parseVaultEntry(validBlob);
      expect(entry.id).toBe("01H7XYZ");
      expect(entry.name).toBe("Tynn API key");
      expect(entry.type).toBe("key");
      expect(entry.lastAccessed).toBeNull();
      expect(entry.owningProject).toBeNull();
      expect(entry.description).toBeUndefined();
    });

    it("preserves description when present", () => {
      const entry = parseVaultEntry({ ...validBlob, description: "primary key for /home/foo" });
      expect(entry.description).toBe("primary key for /home/foo");
    });

    it("drops empty-string description", () => {
      const entry = parseVaultEntry({ ...validBlob, description: "" });
      expect(entry.description).toBeUndefined();
    });

    it.each(VAULT_ENTRY_TYPES)("accepts type %s", (type) => {
      const entry = parseVaultEntry({ ...validBlob, type });
      expect(entry.type).toBe(type);
    });

    it("rejects unknown type with a clear error", () => {
      expect(() => parseVaultEntry({ ...validBlob, type: "secret" })).toThrow(VaultEntryParseError);
      expect(() => parseVaultEntry({ ...validBlob, type: "secret" })).toThrow(/key\|password\|token/);
    });

    it("rejects non-object input", () => {
      expect(() => parseVaultEntry(null)).toThrow(/payload must be an object/);
      expect(() => parseVaultEntry("not-an-object")).toThrow(/payload must be an object/);
      expect(() => parseVaultEntry(42)).toThrow(/payload must be an object/);
    });

    it("rejects missing id", () => {
      const { id: _, ...without } = validBlob;
      expect(() => parseVaultEntry(without)).toThrow(/field "id"/);
    });

    it("rejects empty-string id", () => {
      expect(() => parseVaultEntry({ ...validBlob, id: "" })).toThrow(/field "id"/);
    });

    it("rejects invalid created timestamp", () => {
      expect(() => parseVaultEntry({ ...validBlob, created: "not-a-date" })).toThrow(/field "created"/);
    });

    it("accepts ISO lastAccessed", () => {
      const entry = parseVaultEntry({ ...validBlob, lastAccessed: "2026-04-29T08:30:00.000Z" });
      expect(entry.lastAccessed).toBe("2026-04-29T08:30:00.000Z");
    });

    it("rejects invalid lastAccessed", () => {
      expect(() => parseVaultEntry({ ...validBlob, lastAccessed: "yesterday" })).toThrow(/field "lastAccessed"/);
    });

    it("accepts owningProject path", () => {
      const entry = parseVaultEntry({ ...validBlob, owningProject: "/home/wishborn/projects/sample-go" });
      expect(entry.owningProject).toBe("/home/wishborn/projects/sample-go");
    });

    it("treats undefined owningProject as null", () => {
      const { owningProject: _, ...without } = validBlob;
      const entry = parseVaultEntry(without);
      expect(entry.owningProject).toBeNull();
    });

    it("rejects empty-string owningProject", () => {
      expect(() => parseVaultEntry({ ...validBlob, owningProject: "" })).toThrow(/field "owningProject"/);
    });
  });

  describe("summarizeVaultEntry", () => {
    const fullEntry: VaultEntry = {
      id: "01H7XYZ",
      name: "Tynn API key",
      type: "key",
      created: "2026-04-28T12:00:00.000Z",
      lastAccessed: null,
      owningProject: "/home/wishborn/projects/sample-go",
    };

    it("strips the value and exposes only summary fields", () => {
      const summary = summarizeVaultEntry(fullEntry);
      expect(summary).toMatchObject({
        id: "01H7XYZ",
        name: "Tynn API key",
        type: "key",
        created: "2026-04-28T12:00:00.000Z",
        lastAccessed: null,
      });
      expect(Object.keys(summary)).not.toContain("owningProject");
    });

    it("ownedByProject is true when requestingProject matches owningProject", () => {
      const summary = summarizeVaultEntry(fullEntry, "/home/wishborn/projects/sample-go");
      expect(summary.ownedByProject).toBe(true);
    });

    it("ownedByProject is false when requestingProject mismatches", () => {
      const summary = summarizeVaultEntry(fullEntry, "/home/wishborn/projects/other");
      expect(summary.ownedByProject).toBe(false);
    });

    it("ownedByProject is false when requestingProject is undefined", () => {
      const summary = summarizeVaultEntry(fullEntry);
      expect(summary.ownedByProject).toBe(false);
    });

    it("ownedByProject is always false for gateway-scoped entries (owningProject=null)", () => {
      const gatewayEntry = { ...fullEntry, owningProject: null };
      const summary1 = summarizeVaultEntry(gatewayEntry, "/home/wishborn/projects/sample-go");
      const summary2 = summarizeVaultEntry(gatewayEntry);
      expect(summary1.ownedByProject).toBe(false);
      expect(summary2.ownedByProject).toBe(false);
    });

    it("preserves description in summary when set", () => {
      const withDesc = { ...fullEntry, description: "primary key" };
      const summary = summarizeVaultEntry(withDesc);
      expect(summary.description).toBe("primary key");
    });
  });

  describe("vault reference syntax", () => {
    it("VAULT_REFERENCE_PREFIX is the canonical 'vault://' string", () => {
      expect(VAULT_REFERENCE_PREFIX).toBe("vault://");
    });

    it.each([
      ["vault://01H7XYZ", true],
      ["vault://my-named-key", true],
      ["VAULT://01H7XYZ", false],
      ["http://example.com", false],
      ["plain-string", false],
      ["", false],
    ])("isVaultReference(%j) → %j", (value, expected) => {
      expect(isVaultReference(value)).toBe(expected);
    });

    it("isVaultReference returns false for non-string input", () => {
      expect(isVaultReference(null)).toBe(false);
      expect(isVaultReference(42)).toBe(false);
      expect(isVaultReference({ vault: "01H7XYZ" })).toBe(false);
    });

    it("extractVaultReferenceId pulls the id from a valid reference", () => {
      expect(extractVaultReferenceId("vault://01H7XYZ")).toBe("01H7XYZ");
    });

    it("extractVaultReferenceId returns null for non-references", () => {
      expect(extractVaultReferenceId("plain-string")).toBeNull();
      expect(extractVaultReferenceId("http://example.com")).toBeNull();
    });

    it("extractVaultReferenceId returns null for empty id (vault://)", () => {
      expect(extractVaultReferenceId("vault://")).toBeNull();
    });
  });
});
