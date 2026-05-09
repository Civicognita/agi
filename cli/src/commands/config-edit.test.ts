/**
 * agi doctor config get/set helper tests (s144 t578).
 *
 * Pure-logic helpers for the safe-edit cycle: getDottedPath / setDottedPath
 * / coerceValue. The Zod-validated rollback flow is exercised end-to-end
 * via the CLI command; these tests pin the building blocks.
 */

import { describe, it, expect } from "vitest";
import { getDottedPath, setDottedPath, coerceValue } from "./doctor.js";

describe("getDottedPath (s144 t578)", () => {
  it("reads top-level keys", () => {
    expect(getDottedPath({ a: 1, b: 2 }, "a")).toBe(1);
    expect(getDottedPath({ a: 1 }, "b")).toBe(undefined);
  });

  it("reads nested paths", () => {
    expect(getDottedPath({ gateway: { port: 3100 } }, "gateway.port")).toBe(3100);
    expect(getDottedPath({ a: { b: { c: "deep" } } }, "a.b.c")).toBe("deep");
  });

  it("returns undefined when an intermediate segment is missing", () => {
    expect(getDottedPath({ gateway: {} }, "gateway.port")).toBe(undefined);
    expect(getDottedPath({ x: { y: null } }, "x.y.z")).toBe(undefined);
  });

  it("returns the whole object on empty path", () => {
    const obj = { a: 1 };
    expect(getDottedPath(obj, "")).toBe(obj);
  });

  it("does not crash on null/undefined input", () => {
    expect(getDottedPath(null, "a")).toBe(undefined);
    expect(getDottedPath(undefined, "a")).toBe(undefined);
    expect(getDottedPath(42 as unknown, "a")).toBe(undefined);
  });
});

describe("setDottedPath (s144 t578)", () => {
  it("sets a top-level key on a clone (does not mutate input)", () => {
    const obj = { a: 1, b: 2 };
    const out = setDottedPath(obj, "a", 99) as Record<string, unknown>;
    expect(out).toEqual({ a: 99, b: 2 });
    expect(obj).toEqual({ a: 1, b: 2 });
  });

  it("creates intermediate objects when missing", () => {
    const obj = {} as Record<string, unknown>;
    const out = setDottedPath(obj, "gateway.tls.cert", "/etc/cert.pem") as Record<string, unknown>;
    expect(out).toEqual({ gateway: { tls: { cert: "/etc/cert.pem" } } });
    expect(obj).toEqual({}); // input untouched
  });

  it("overwrites a non-object intermediate with an object before descending", () => {
    const obj = { a: "scalar" };
    const out = setDottedPath(obj, "a.b.c", 1) as Record<string, unknown>;
    expect(out).toEqual({ a: { b: { c: 1 } } });
  });

  it("preserves siblings when setting nested values", () => {
    const obj = { gateway: { port: 3100, host: "127.0.0.1" } };
    const out = setDottedPath(obj, "gateway.port", 4100) as Record<string, unknown>;
    expect(out).toEqual({ gateway: { port: 4100, host: "127.0.0.1" } });
  });

  it("can replace deep values with arrays/objects", () => {
    const obj = { workspace: { projects: ["/a"] } };
    const out = setDottedPath(obj, "workspace.projects", ["/b", "/c"]) as Record<string, unknown>;
    expect(out).toEqual({ workspace: { projects: ["/b", "/c"] } });
  });

  it("returns the new value when path is empty", () => {
    expect(setDottedPath({ a: 1 }, "", { b: 2 })).toEqual({ b: 2 });
  });
});

describe("coerceValue (s144 t578)", () => {
  it("parses booleans and null", () => {
    expect(coerceValue("true")).toBe(true);
    expect(coerceValue("false")).toBe(false);
    expect(coerceValue("null")).toBe(null);
  });

  it("parses safe-integer strings as numbers", () => {
    expect(coerceValue("0")).toBe(0);
    expect(coerceValue("3100")).toBe(3100);
    expect(coerceValue("-1")).toBe(-1);
  });

  it("does NOT parse floats as numbers (no decimal regex)", () => {
    // Float coercion is intentionally excluded — config values are
    // virtually always integers (ports, counts, timeouts).
    expect(coerceValue("3.14")).toBe("3.14");
  });

  it("rejects out-of-range integers, falls back to string", () => {
    expect(coerceValue("99999999999999999999")).toBe("99999999999999999999");
  });

  it("parses JSON object/array literals", () => {
    expect(coerceValue('{"a":1}')).toEqual({ a: 1 });
    expect(coerceValue("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("returns the raw string when JSON parse fails", () => {
    expect(coerceValue("{not valid")).toBe("{not valid");
    expect(coerceValue("[also not")).toBe("[also not");
  });

  it("treats arbitrary strings verbatim", () => {
    expect(coerceValue("/etc/cert.pem")).toBe("/etc/cert.pem");
    expect(coerceValue("aionima")).toBe("aionima");
    expect(coerceValue("")).toBe("");
  });
});
