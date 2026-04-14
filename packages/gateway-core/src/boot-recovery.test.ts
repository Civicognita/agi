import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readAndConsumeShutdownMarker,
  peekShutdownMarker,
  writeShutdownMarker,
  buildShutdownMarker,
  type ShutdownMarker,
} from "./boot-recovery.js";
import { classifyIncident, type Evidence } from "./safemode-investigator.js";

let tmp: string;
let markerPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "aionima-boot-rec-"));
  markerPath = join(tmp, "shutdown-state.json");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("shutdown marker", () => {
  it("returns null when marker missing (crash detection)", () => {
    expect(readAndConsumeShutdownMarker(markerPath)).toBeNull();
  });

  it("roundtrips a valid marker and deletes it after read", () => {
    const marker = buildShutdownMarker(
      [{ slug: "project-a", containerName: "aionima-project-a" }],
      [{ modelId: "some/Model", containerName: "aionima-model-some--Model" }],
      "restart",
    );
    writeShutdownMarker(marker, markerPath);
    expect(existsSync(markerPath)).toBe(true);

    const consumed = readAndConsumeShutdownMarker(markerPath);
    expect(consumed).not.toBeNull();
    expect(consumed!.version).toBe(1);
    expect(consumed!.reason).toBe("restart");
    expect(consumed!.projects).toHaveLength(1);
    expect(consumed!.projects[0]!.slug).toBe("project-a");
    expect(consumed!.models).toHaveLength(1);
    expect(existsSync(markerPath)).toBe(false);
  });

  it("deletes a corrupt marker so it doesn't mask crashes", () => {
    writeFileSync(markerPath, "{not json", "utf8");
    expect(existsSync(markerPath)).toBe(true);

    const consumed = readAndConsumeShutdownMarker(markerPath);
    expect(consumed).toBeNull();
    expect(existsSync(markerPath)).toBe(false);
  });

  it("rejects unknown marker versions", () => {
    const badMarker = { version: 99, shutdownAt: "x" } as unknown as ShutdownMarker;
    writeFileSync(markerPath, JSON.stringify(badMarker), "utf8");
    const consumed = readAndConsumeShutdownMarker(markerPath);
    expect(consumed).toBeNull();
  });

  it("peek does not consume the marker", () => {
    const marker = buildShutdownMarker([], [], "sigterm");
    writeShutdownMarker(marker, markerPath);
    expect(peekShutdownMarker(markerPath)?.reason).toBe("sigterm");
    expect(existsSync(markerPath)).toBe(true);
  });

  it("buildShutdownMarker populates externals defaults", () => {
    const marker = buildShutdownMarker([], [], "sigterm");
    expect(marker.externals.idPostgresContainer).toBe("aionima-id-postgres");
    expect(marker.externals.idService).toBe("aionima-id.service");
    expect(marker.pid).toBe(process.pid);
    expect(new Date(marker.shutdownAt).toString()).not.toBe("Invalid Date");
  });
});

describe("classifyIncident — heuristics", () => {
  const emptyEvidence = (): Evidence => ({
    collectedAt: new Date().toISOString(),
    hadPriorMarker: false,
    gatewayJournal: "",
    idServiceJournal: "",
    gatewayLog: "",
    podmanPs: "",
    postgresLogs: "",
    dmesg: "",
    diskRoot: "",
    diskAgi: "",
  });

  it("classifies ECONNREFUSED:5433 as postgres_unreachable", () => {
    const e = emptyEvidence();
    e.gatewayLog = "Error: connect ECONNREFUSED 127.0.0.1:5433";
    const c = classifyIncident(e);
    expect(c.classification).toBe("postgres_unreachable");
    expect(c.autoRecoverable).toBe(true);
    expect(c.confidence).toBe("high");
  });

  it("classifies OOM killer as oom_killed", () => {
    const e = emptyEvidence();
    e.dmesg = "[12345.67] Out of memory: Killed process 999 (node) total-vm:...";
    const c = classifyIncident(e);
    expect(c.classification).toBe("oom_killed");
    expect(c.autoRecoverable).toBe(false);
  });

  it("classifies disk pressure from df output", () => {
    const e = emptyEvidence();
    e.diskRoot = "Filesystem   Size  Used Avail Use% Mounted on\n/dev/sda1    100G   98G  500M  99% /";
    const c = classifyIncident(e);
    expect(c.classification).toBe("disk_full");
    expect(c.autoRecoverable).toBe(false);
  });

  it("classifies ID service failure", () => {
    const e = emptyEvidence();
    e.idServiceJournal = "aionima-id.service: Start-Pre process exited with code 1";
    const c = classifyIncident(e);
    expect(c.classification).toBe("id_service_failed");
    expect(c.autoRecoverable).toBe(true);
  });

  it("returns unknown when no pattern matches", () => {
    const c = classifyIncident(emptyEvidence());
    expect(c.classification).toBe("unknown");
    expect(c.confidence).toBe("low");
    // Even unknown incidents should remain auto-recoverable — the "Recover now"
    // flow is safe to attempt in any state.
    expect(c.autoRecoverable).toBe(true);
  });
});

describe("marker file format", () => {
  it("produces valid JSON that can be read by external tools", () => {
    const marker = buildShutdownMarker(
      [{ slug: "s", containerName: "c" }],
      [],
      "upgrade",
    );
    writeShutdownMarker(marker, markerPath);
    const raw = readFileSync(markerPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.reason).toBe("upgrade");
  });
});
