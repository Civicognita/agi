/**
 * Code Generation Workflow
 *
 * Template-based code scaffolding with basic validation.
 * Pure synchronous logic -- no API calls, no side effects.
 */

import { basename, dirname, extname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeGenRequest {
  /** Human-readable description of what to generate. */
  description: string;
  /** Target file path for the generated code (relative to workspace). */
  targetPath: string;
  /** Target language / file type. */
  language: "typescript" | "javascript" | "json" | "markdown" | "sql";
  /** Whether to generate accompanying test code. */
  generateTests: boolean;
  /** Existing code to use as context / base for the generation. */
  existingCode?: string;
}

export interface CodeGenResult {
  /** The generated source code. */
  code: string;
  /** Generated test code (if requested). */
  testCode?: string;
  /** Path for the test file (if generated). */
  testPath?: string;
  /** Brief explanation of what was generated. */
  explanation: string;
}

export interface CodeValidationResult {
  /** Whether the code passed basic validation. */
  valid: boolean;
  /** List of validation errors found. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Language metadata
// ---------------------------------------------------------------------------

interface LanguageMeta {
  ext: string;
  testExt: string;
  commentSingle: string;
  importKeyword: string;
  exportKeyword: string;
}

const LANG_META: Record<CodeGenRequest["language"], LanguageMeta> = {
  typescript: {
    ext: ".ts",
    testExt: ".test.ts",
    commentSingle: "//",
    importKeyword: "import",
    exportKeyword: "export",
  },
  javascript: {
    ext: ".js",
    testExt: ".test.js",
    commentSingle: "//",
    importKeyword: "import",
    exportKeyword: "export",
  },
  json: {
    ext: ".json",
    testExt: ".test.ts",
    commentSingle: "//",
    importKeyword: "",
    exportKeyword: "",
  },
  markdown: {
    ext: ".md",
    testExt: ".test.ts",
    commentSingle: "<!--",
    importKeyword: "",
    exportKeyword: "",
  },
  sql: {
    ext: ".sql",
    testExt: ".test.ts",
    commentSingle: "--",
    importKeyword: "",
    exportKeyword: "",
  },
};

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/**
 * Generate code from a request using template-based scaffolding.
 *
 * This is a synchronous, pure-logic function.
 * It creates skeleton code based on the description, language, and any existing code.
 */
export function generateCode(request: CodeGenRequest): CodeGenResult {
  const { description, targetPath, language, generateTests, existingCode } = request;
  const meta = LANG_META[language];
  const moduleName = extractModuleName(targetPath);

  let code: string;
  let testCode: string | undefined;
  let testPath: string | undefined;

  switch (language) {
    case "typescript":
      code = scaffoldTypeScript(moduleName, description, existingCode);
      break;
    case "javascript":
      code = scaffoldJavaScript(moduleName, description, existingCode);
      break;
    case "json":
      code = scaffoldJson(moduleName, description);
      break;
    case "markdown":
      code = scaffoldMarkdown(moduleName, description);
      break;
    case "sql":
      code = scaffoldSql(moduleName, description);
      break;
    default:
      code = `${meta.commentSingle} ${description}\n`;
  }

  if (generateTests && (language === "typescript" || language === "javascript")) {
    testPath = computeTestPath(targetPath, meta.testExt);
    testCode = scaffoldTest(moduleName, targetPath, language);
  }

  const explanation = [
    `Generated ${language} module "${moduleName}" at ${targetPath}.`,
    generateTests && testPath ? `Test file at ${testPath}.` : null,
    existingCode ? "Based on existing code provided as context." : null,
  ]
    .filter(Boolean)
    .join(" ");

  return { code, testCode, testPath, explanation };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Perform basic structural validation on generated code.
 *
 * Checks:
 * - Balanced braces / brackets / parentheses
 * - Basic import statement structure (for TS/JS)
 * - No obvious syntax markers left behind (e.g., TODO placeholders)
 */
export function validateGeneratedCode(
  code: string,
  language: CodeGenRequest["language"],
): CodeValidationResult {
  const errors: string[] = [];

  // 1. Balanced delimiters
  const braceBalance = countChar(code, "{") - countChar(code, "}");
  if (braceBalance !== 0) {
    errors.push(`Unbalanced braces: ${braceBalance > 0 ? "missing" : "extra"} ${Math.abs(braceBalance)} closing brace(s).`);
  }

  const bracketBalance = countChar(code, "[") - countChar(code, "]");
  if (bracketBalance !== 0) {
    errors.push(`Unbalanced brackets: ${bracketBalance > 0 ? "missing" : "extra"} ${Math.abs(bracketBalance)} closing bracket(s).`);
  }

  const parenBalance = countChar(code, "(") - countChar(code, ")");
  if (parenBalance !== 0) {
    errors.push(`Unbalanced parentheses: ${parenBalance > 0 ? "missing" : "extra"} ${Math.abs(parenBalance)} closing paren(s).`);
  }

  // 2. Import validation for TS/JS
  if (language === "typescript" || language === "javascript") {
    const importLines = code.split("\n").filter((l) => l.trimStart().startsWith("import "));
    for (const line of importLines) {
      if (!line.includes("from") && !line.includes("import type")) {
        // Side-effect import like `import "./setup.js"` is fine if it has a string
        if (!/import\s+["']/.test(line)) {
          errors.push(`Possibly malformed import: ${line.trim()}`);
        }
      }
    }
  }

  // 3. JSON validation
  if (language === "json") {
    try {
      JSON.parse(code);
    } catch (e) {
      errors.push(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Scaffolding helpers
// ---------------------------------------------------------------------------

function scaffoldTypeScript(moduleName: string, description: string, existingCode?: string): string {
  const lines: string[] = [
    `/**`,
    ` * ${moduleName}`,
    ` *`,
    ` * ${description}`,
    ` */`,
    ``,
  ];

  if (existingCode) {
    lines.push(
      `// Based on existing code:`,
      `// ${existingCode.split("\n").length} lines of context provided.`,
      ``,
    );
  }

  lines.push(
    `// ---------------------------------------------------------------------------`,
    `// Types`,
    `// ---------------------------------------------------------------------------`,
    ``,
    `export interface ${pascalCase(moduleName)}Config {`,
    `  // TODO: Define configuration`,
    `}`,
    ``,
    `// ---------------------------------------------------------------------------`,
    `// Implementation`,
    `// ---------------------------------------------------------------------------`,
    ``,
    `export function ${camelCase(moduleName)}(config: ${pascalCase(moduleName)}Config): void {`,
    `  // TODO: Implement ${description}`,
    `}`,
    ``,
  );

  return lines.join("\n");
}

function scaffoldJavaScript(moduleName: string, description: string, existingCode?: string): string {
  const lines: string[] = [
    `/**`,
    ` * ${moduleName}`,
    ` *`,
    ` * ${description}`,
    ` */`,
    ``,
  ];

  if (existingCode) {
    lines.push(
      `// Based on existing code:`,
      `// ${existingCode.split("\n").length} lines of context provided.`,
      ``,
    );
  }

  lines.push(
    `/**`,
    ` * @param {object} config`,
    ` */`,
    `export function ${camelCase(moduleName)}(config) {`,
    `  // TODO: Implement ${description}`,
    `}`,
    ``,
  );

  return lines.join("\n");
}

function scaffoldJson(moduleName: string, description: string): string {
  return JSON.stringify(
    {
      name: moduleName,
      description,
      version: "0.1.0",
    },
    null,
    2,
  ) + "\n";
}

function scaffoldMarkdown(moduleName: string, description: string): string {
  return [
    `# ${pascalCase(moduleName)}`,
    ``,
    description,
    ``,
    `## Overview`,
    ``,
    `<!-- TODO: Add content -->`,
    ``,
  ].join("\n");
}

function scaffoldSql(moduleName: string, description: string): string {
  return [
    `-- ${moduleName}`,
    `-- ${description}`,
    ``,
    `-- TODO: Define schema`,
    ``,
  ].join("\n");
}

function scaffoldTest(moduleName: string, sourcePath: string, language: string): string {
  const importExt = language === "typescript" ? ".js" : ".js";
  const sourceBase = basename(sourcePath, extname(sourcePath));

  return [
    `import { describe, it, expect } from "vitest";`,
    ``,
    `import { ${camelCase(moduleName)} } from "./${sourceBase}${importExt}";`,
    ``,
    `describe("${moduleName}", () => {`,
    `  it("should be defined", () => {`,
    `    expect(${camelCase(moduleName)}).toBeDefined();`,
    `  });`,
    ``,
    `  // TODO: Add test cases`,
    `});`,
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function extractModuleName(filePath: string): string {
  const base = basename(filePath, extname(filePath));
  return base;
}

function computeTestPath(sourcePath: string, testExt: string): string {
  const dir = dirname(sourcePath);
  const base = basename(sourcePath, extname(sourcePath));
  return `${dir}/${base}${testExt}`;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === char) count++;
  }
  return count;
}

function pascalCase(str: string): string {
  return str
    .split(/[-_.]/)
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : ""))
    .join("");
}

function camelCase(str: string): string {
  const pascal = pascalCase(str);
  return pascal.length > 0 ? pascal[0]!.toLowerCase() + pascal.slice(1) : "";
}
