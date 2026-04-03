---
name: issue
description: Analyze bug reports and issues to identify root causes and suggest fixes
domain: development
triggers:
  - analyze issue
  - debug
  - bug report
  - root cause
  - why is this failing
  - investigate error
  - trace the problem
requires_state: [ONLINE]
requires_tier: verified
priority: 10
direct_invoke: true
---

When asked to analyze an issue or bug, follow this structured approach to identify root causes and suggest fixes.

## Analysis Steps

1. **Gather context** — Read the issue description carefully. Extract: error messages, file references (e.g., `src/foo.ts`), recent commit context, and reproduction steps.

2. **Read related files** — Use `file_read` to examine files mentioned in the issue. Use `grep_search` to find relevant code patterns.

3. **Match error patterns** — Apply keyword heuristics to identify the likely root cause:

| Pattern | Root Cause | Approach |
|---------|------------|----------|
| `cannot find module`, `import not found` | Missing or incorrect module import | Check import paths; use `.js` extensions for ESM |
| `TypeError`, `is not assignable`, `property does not exist` | TypeScript type mismatch | Review type definitions across modules |
| `null`, `undefined is not`, `cannot read propert` | Null/undefined reference | Add null checks or optional chaining |
| `timeout`, `ETIMEDOUT`, `deadline exceeded` | Operation timeout | Increase timeouts, add retry logic |
| `permission denied`, `EACCES`, `403` | Permission or auth failure | Check tokens, file permissions, auth logic |
| `syntax error`, `unexpected token` | Syntax error | Run `npx tsc --noEmit` and fix indicated location |
| `out of memory`, `heap`, `allocation failed` | Memory exhaustion | Profile for leaks, consider streaming |
| `ECONNREFUSED`, `connection refused` | Network connection failure | Verify service is running, check ports |
| `test fail`, `assertion`, `expect.*to` | Test assertion failure | Compare expected vs. actual; check if impl changed |
| `race condition`, `deadlock` | Concurrency issue | Review shared state, add synchronization |

4. **Estimate complexity:**
   - **low** — typo, missing import, wrong path, rename, formatting (likely auto-fixable)
   - **medium** — logic bug in 2-5 files, missing null check, incorrect type
   - **high** — refactor, migration, architecture change, security vulnerability, race condition

5. **Determine auto-fixability** — An issue is auto-fixable when complexity is `low` AND it matches: typo, missing import, wrong path, unused variable, lint/formatting, missing export.

## Output Format

Always report:
- **Root Cause:** one clear sentence
- **Suggested Approach:** concrete next steps
- **Affected Files:** list all files likely involved
- **Complexity:** low / medium / high
- **Auto-Fixable:** yes / no

If you cannot determine the root cause from the description alone, say so clearly and list what additional information would help (logs, stack trace, related files).

## Important Notes

- Scan file contents as well as the issue description for error pattern matches
- File references in issue text (e.g., `src/foo.ts`, `./bar.js`) are affected files — include them
- More than 5 affected files always signals high complexity
- Race conditions and security vulnerabilities always signal high complexity
