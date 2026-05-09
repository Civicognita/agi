import { describe, expect, it } from "vitest";
import {
  ITERATIVE_WORK_NOTIFICATION_TYPE,
  mapIterativeWorkCompletionToParams,
  type IterativeWorkNotificationMetadata,
} from "./notification-mapper.js";
import type { IterativeWorkCompletion } from "./types.js";

const baseCompletion: IterativeWorkCompletion = {
  projectPath: "/home/wishborn/_projects/_aionima/agi",
  cron: "*/30 * * * *",
  firedAt: "2026-04-28T05:00:00.000Z",
  completedAt: "2026-04-28T05:23:45.000Z",
  durationMs: 1_425_000, // 23m 45s
  status: "done",
};

describe("mapIterativeWorkCompletionToParams (s124 t470)", () => {
  it("emits the canonical type tag", () => {
    const params = mapIterativeWorkCompletionToParams(baseCompletion);
    expect(params.type).toBe(ITERATIVE_WORK_NOTIFICATION_TYPE);
    expect(params.type).toBe("iterative-work");
  });

  it("infers the project name from the last path segment when none provided", () => {
    const params = mapIterativeWorkCompletionToParams(baseCompletion);
    expect(params.title).toContain("agi");
  });

  it("uses the explicit project name when provided", () => {
    const params = mapIterativeWorkCompletionToParams(baseCompletion, "Custom Name");
    expect(params.title).toContain("Custom Name");
    expect(params.title).not.toContain("agi");
  });

  it("title says 'Iteration complete' for done status", () => {
    const params = mapIterativeWorkCompletionToParams(baseCompletion, "proj");
    expect(params.title).toBe("proj · Iteration complete");
  });

  it("title says 'Iteration failed' for error status", () => {
    const params = mapIterativeWorkCompletionToParams(
      { ...baseCompletion, status: "error", error: "boom" },
      "proj",
    );
    expect(params.title).toBe("proj · Iteration failed");
  });

  it("body uses summary when artifact.summary is set", () => {
    const params = mapIterativeWorkCompletionToParams({
      ...baseCompletion,
      artifact: { summary: "Shipped v0.4.300: dashboard EChart fix" },
    });
    expect(params.body).toBe("Shipped v0.4.300: dashboard EChart fix");
  });

  it("body falls back to duration sentence when no summary", () => {
    const params = mapIterativeWorkCompletionToParams(baseCompletion);
    expect(params.body).toMatch(/Cycle finished in \d+m( \d+s)?\.|Cycle finished in \d+s\./);
    expect(params.body).toContain("23m 45s");
  });

  it("body for error includes the error message", () => {
    const params = mapIterativeWorkCompletionToParams({
      ...baseCompletion,
      status: "error",
      error: "drizzle migration failed",
    });
    expect(params.body).toContain("drizzle migration failed");
    expect(params.body).toContain("errored");
  });

  it("metadata carries the flat shape with completion fields populated", () => {
    const params = mapIterativeWorkCompletionToParams(baseCompletion);
    const meta = params.metadata as IterativeWorkNotificationMetadata;
    expect(meta.projectPath).toBe(baseCompletion.projectPath);
    expect(meta.cron).toBe(baseCompletion.cron);
    expect(meta.firedAt).toBe(baseCompletion.firedAt);
    expect(meta.completedAt).toBe(baseCompletion.completedAt);
    expect(meta.durationMs).toBe(baseCompletion.durationMs);
    expect(meta.status).toBe("done");
  });

  it("metadata omits artifact fields when artifact is undefined", () => {
    const params = mapIterativeWorkCompletionToParams(baseCompletion);
    const meta = params.metadata as IterativeWorkNotificationMetadata;
    expect(meta.thumbnailPath).toBeUndefined();
    expect(meta.summary).toBeUndefined();
    expect(meta.chatSessionId).toBeUndefined();
    expect(meta.taskNumber).toBeUndefined();
    expect(meta.commitHash).toBeUndefined();
    expect(meta.shipVersion).toBeUndefined();
  });

  it("metadata carries every artifact field when artifact is fully populated", () => {
    const params = mapIterativeWorkCompletionToParams({
      ...baseCompletion,
      artifact: {
        thumbnailPath: "/var/agi/thumbs/iter-1.png",
        summary: "shipped v0.4.300",
        chatSessionId: "chat-abc-123",
        taskNumber: 470,
        commitHash: "dcf0dea",
        shipVersion: "0.4.301",
      },
    });
    const meta = params.metadata as IterativeWorkNotificationMetadata;
    expect(meta.thumbnailPath).toBe("/var/agi/thumbs/iter-1.png");
    expect(meta.summary).toBe("shipped v0.4.300");
    expect(meta.chatSessionId).toBe("chat-abc-123");
    expect(meta.taskNumber).toBe(470);
    expect(meta.commitHash).toBe("dcf0dea");
    expect(meta.shipVersion).toBe("0.4.301");
  });

  it("error metadata carries error field; done metadata omits it", () => {
    const errParams = mapIterativeWorkCompletionToParams({
      ...baseCompletion,
      status: "error",
      error: "boom",
    });
    expect((errParams.metadata as IterativeWorkNotificationMetadata).error).toBe("boom");

    const doneParams = mapIterativeWorkCompletionToParams(baseCompletion);
    expect((doneParams.metadata as IterativeWorkNotificationMetadata).error).toBeUndefined();
  });

  it("formats sub-minute durations as plain seconds", () => {
    const params = mapIterativeWorkCompletionToParams({ ...baseCompletion, durationMs: 12_345 });
    expect(params.body).toContain("12s");
  });

  it("formats hour-plus durations with hour units", () => {
    const params = mapIterativeWorkCompletionToParams({
      ...baseCompletion,
      durationMs: 90 * 60 * 1000, // 1h 30m
    });
    expect(params.body).toContain("1h 30m");
  });
});
