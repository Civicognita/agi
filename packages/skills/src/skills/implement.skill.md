---
name: implement
description: Generate code using template-based scaffolding with validation
domain: development
triggers:
  - generate code
  - scaffold
  - create module
  - implement function
  - write a test
  - create a file
  - new component
requires_state: [ONLINE]
requires_tier: verified
priority: 10
direct_invoke: true
---

When asked to generate or scaffold code, use template-based patterns appropriate to the target language. Always validate output before writing.

## Supported Languages

| Language | Extension | Test Extension |
|----------|-----------|----------------|
| TypeScript | `.ts` | `.test.ts` |
| JavaScript | `.js` | `.test.js` |
| JSON | `.json` | `.test.ts` |
| Markdown | `.md` | — |
| SQL | `.sql` | — |

## Generation Workflow

1. **Understand the request** — Identify: what to generate, target path, language, and whether tests are needed.

2. **Read existing code** — If a related file exists, read it first with `file_read`. Existing code provides naming conventions, import styles, and interface shapes.

3. **Apply the scaffold template:**

### TypeScript module
```typescript
/**
 * <moduleName>
 *
 * <description>
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface <ModuleName>Config {
  // define configuration fields
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function <moduleName>(config: <ModuleName>Config): void {
  // implement here
}
```

### Test file (TypeScript/JavaScript)
```typescript
import { describe, it, expect } from "vitest";

import { <moduleName> } from "./<sourceBase>.js";

describe("<moduleName>", () => {
  it("should be defined", () => {
    expect(<moduleName>).toBeDefined();
  });

  // add test cases
});
```

### JSON config
```json
{
  "name": "<moduleName>",
  "description": "<description>",
  "version": "0.1.0"
}
```

### SQL schema
```sql
-- <moduleName>
-- <description>

-- define schema here
```

## Validation Checklist

Before writing, verify the generated code passes these checks:

- **Balanced delimiters** — equal `{}`、`[]`、`()` counts
- **Import structure** — every `import` has a `from` clause (or is a side-effect import)
- **ESM extensions** — TypeScript imports use `.js` extension in the `from` path
- **JSON validity** — parse the JSON; fix any syntax errors
- **No leftover placeholders** — replace all `// TODO: ...` stubs with real logic when the implementation is known

After writing a file, always run:
```
shell_exec: npx tsc --noEmit
```
Fix any type errors before finishing.

## Circuit Breaker

If the same validation error appears after 3 generation attempts, stop and report the specific error to the user rather than looping further. Ask for clarification on the failing requirement.

## Naming Conventions

- Module name: derived from the file basename (e.g., `session-manager.ts` → `sessionManager`)
- PascalCase for types and interfaces: `SessionManager`
- camelCase for functions and variables: `sessionManager`
- kebab-case for file names: `session-manager.ts`

## Test Placement

Tests are co-located with source: `src/foo.ts` → `src/foo.test.ts`. Import the source using `.js` extension even in test files.
