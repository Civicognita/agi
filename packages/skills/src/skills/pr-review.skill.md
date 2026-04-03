---
name: pr-review
description: Review pull request diffs for security issues, style problems, and correctness bugs
domain: development
triggers:
  - review pr
  - review pull request
  - check my diff
  - code review
  - audit changes
  - review this patch
requires_state: [ONLINE]
requires_tier: verified
priority: 10
direct_invoke: true
---

When asked to review a pull request or diff, analyze added lines for security risks, style issues, correctness bugs, and performance problems. Produce a structured verdict with actionable comments.

## Review Process

1. **Parse the diff** — Identify changed files from `diff --git a/... b/...` headers. For each hunk (`@@ -old +new @@`), analyze only added lines (those starting with `+`).

2. **Apply pattern detection** on each added line:

### Security (severity: error / warning)
| Pattern | Issue |
|---------|-------|
| `console.log(.*password\|secret\|token\|api.key)` | Potential secret logged to console |
| `eval(` | Use of `eval()` is a security risk |
| `innerHTML =` | Potential XSS vector |
| `process.env.*log\|console\|print` | Environment variable may be logged |

### Style (severity: info)
| Pattern | Issue |
|---------|-------|
| `any` (type annotation) | Explicit `any` — consider a more specific type |
| `// TODO` | TODO comment — track in issue tracker |
| `eslint-disable` | ESLint rule disabled — ensure this is necessary |

### Performance (severity: warning / info)
| Pattern | Issue |
|---------|-------|
| `new RegExp(...)` inside iterator | RegExp compiled in loop — move outside |
| `JSON.parse(JSON.stringify(` | Deep clone via JSON — prefer `structuredClone()` |

### Correctness (severity: warning / info)
| Pattern | Issue |
|---------|-------|
| `== ` (loose equality) | Prefer strict equality `===` |
| `catch () {` (empty catch) | Errors silently swallowed |
| `.then(...)` without `.catch()` | Unhandled promise rejection risk |

3. **Estimate complexity** from total lines changed and file count:
   - **trivial** — ≤10 lines, ≤1 file
   - **low** — ≤50 lines, ≤3 files
   - **medium** — ≤200 lines, ≤8 files
   - **high** — >200 lines or >8 files

4. **Identify hotspots** — Files with the most issues (top 3).

5. **Determine verdict:**
   - `request_changes` — any error-severity finding
   - `comment` — more than 2 warning-severity findings, no errors
   - `approve` — 0 errors, ≤2 warnings

## Output Format

Always produce:

```
## PR Review

**<Verdict>** — N comments (E errors, W warnings) | F files | +added -removed

### Comments
- [X] **file.ts:42** — <error message> (security)
- [!] **file.ts:87** — <warning message> (correctness)
- [i] **file.ts:12** — <info message> (style)

**Hotspots:** file-a.ts, file-b.ts
**Complexity:** medium
```

Use `[X]` for errors, `[!]` for warnings, `[i]` for info.

## Important Notes

- Only flag added lines (`+` prefix). Removed lines and context lines are not reviewed.
- Report the approximate line number from the hunk header for each finding.
- If no diff is provided, ask the entity to supply one: `git diff HEAD`, `git diff main...branch`, or paste the unified diff directly.
- Keep comments actionable — include what to do, not just what is wrong.
