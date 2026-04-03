/**
 * Code Generation Workflow Tests — Story 16
 *
 * Covers:
 * - TypeScript scaffolding
 * - JavaScript scaffolding
 * - JSON scaffolding
 * - Test file generation
 * - Code validation (balanced delimiters, import checking)
 */

import { describe, it, expect } from "vitest";
import { generateCode, validateGeneratedCode } from "./code-generation.js";

describe("generateCode", () => {
  it("generates TypeScript code", () => {
    const result = generateCode({
      description: "A utility module for string manipulation",
      targetPath: "src/utils/strings.ts",
      language: "typescript",
      generateTests: false,
    });

    expect(result.code).toContain("export");
    expect(result.explanation).toBeTruthy();
    expect(result.testCode).toBeUndefined();
  });

  it("generates TypeScript with tests", () => {
    const result = generateCode({
      description: "A helper for date formatting",
      targetPath: "src/utils/dates.ts",
      language: "typescript",
      generateTests: true,
    });

    expect(result.code).toContain("export");
    expect(result.testCode).toBeDefined();
    expect(result.testPath).toBeDefined();
    expect(result.testPath).toContain(".test.ts");
  });

  it("generates JavaScript code", () => {
    const result = generateCode({
      description: "A config loader module",
      targetPath: "src/config-loader.js",
      language: "javascript",
      generateTests: false,
    });

    expect(result.code).toContain("export");
    expect(result.explanation).toBeTruthy();
  });

  it("generates JSON code", () => {
    const result = generateCode({
      description: "A package.json configuration",
      targetPath: "package.json",
      language: "json",
      generateTests: false,
    });

    expect(result.code).toBeTruthy();
    expect(result.explanation).toBeTruthy();
  });

  it("generates Markdown code", () => {
    const result = generateCode({
      description: "API documentation for the auth module",
      targetPath: "docs/auth.md",
      language: "markdown",
      generateTests: false,
    });

    expect(result.code).toContain("#");
    expect(result.explanation).toBeTruthy();
  });

  it("generates SQL code", () => {
    const result = generateCode({
      description: "Migration to add users table",
      targetPath: "migrations/001-users.sql",
      language: "sql",
      generateTests: false,
    });

    expect(result.code).toBeTruthy();
    expect(result.explanation).toBeTruthy();
  });

  it("includes existing code context", () => {
    const result = generateCode({
      description: "Add a new method to the existing module",
      targetPath: "src/existing.ts",
      language: "typescript",
      generateTests: false,
      existingCode: "export function existing() { return 42; }",
    });

    expect(result.code).toBeTruthy();
    expect(result.explanation).toBeTruthy();
  });
});

describe("validateGeneratedCode", () => {
  it("validates balanced braces in TypeScript", () => {
    const result = validateGeneratedCode(
      "export function foo() { return { a: 1 }; }",
      "typescript",
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects unbalanced braces", () => {
    const result = validateGeneratedCode(
      "export function foo() { return { a: 1 };",
      "typescript",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("detects unbalanced brackets", () => {
    const result = validateGeneratedCode(
      "const arr = [1, 2, 3;",
      "typescript",
    );
    expect(result.valid).toBe(false);
  });

  it("detects unbalanced parentheses", () => {
    const result = validateGeneratedCode(
      "console.log('hello';",
      "typescript",
    );
    expect(result.valid).toBe(false);
  });

  it("validates valid JSON", () => {
    const result = validateGeneratedCode(
      '{ "name": "test", "version": "1.0.0" }',
      "json",
    );
    expect(result.valid).toBe(true);
  });

  it("detects invalid JSON", () => {
    const result = validateGeneratedCode(
      '{ name: "test" }',
      "json",
    );
    expect(result.valid).toBe(false);
  });
});
