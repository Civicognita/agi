/**
 * project-type-classifier tests — verifies the dashboard mirror of
 * gateway-core's DESKTOP_SERVED_TYPES / CODE_SERVED_TYPES classification.
 *
 * The real source of truth is gateway-core/src/project-types.ts. The
 * dashboard duplicates the constants because it can't import gateway-core.
 * These tests pin the dashboard's view; the gateway-core suite pins the
 * backend's view; together they enforce the shared contract.
 */

import { describe, expect, it } from "vitest";
import {
  CODE_SERVED_TYPES,
  DESKTOP_SERVED_TYPES,
  isDesktopServedType,
} from "./project-type-classifier";

describe("isDesktopServedType", () => {
  it("classifies all DESKTOP_SERVED_TYPES as Desktop-served", () => {
    for (const t of DESKTOP_SERVED_TYPES) {
      expect(isDesktopServedType(t)).toBe(true);
    }
  });

  it("classifies all CODE_SERVED_TYPES as code-served", () => {
    for (const t of CODE_SERVED_TYPES) {
      expect(isDesktopServedType(t)).toBe(false);
    }
  });

  it("returns false for unknown / null / undefined / empty", () => {
    expect(isDesktopServedType(null)).toBe(false);
    expect(isDesktopServedType(undefined)).toBe(false);
    expect(isDesktopServedType("")).toBe(false);
    expect(isDesktopServedType("never-registered-type")).toBe(false);
  });

  it("includes the canonical s150 set on the Desktop side", () => {
    expect(isDesktopServedType("ops")).toBe(true);
    expect(isDesktopServedType("media")).toBe(true);
    expect(isDesktopServedType("literature")).toBe(true);
    expect(isDesktopServedType("documentation")).toBe(true);
    expect(isDesktopServedType("backup-aggregator")).toBe(true);
  });

  it("includes the canonical s150 set on the code side", () => {
    expect(isDesktopServedType("web-app")).toBe(false);
    expect(isDesktopServedType("static-site")).toBe(false);
    expect(isDesktopServedType("api-service")).toBe(false);
    expect(isDesktopServedType("php-app")).toBe(false);
    expect(isDesktopServedType("monorepo")).toBe(false);
  });
});
