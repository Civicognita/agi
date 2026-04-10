---
name: worker-tester
description: Validation worker that tests hacker output by running type checks, linting, and unit tests. Computes error hashes for STUMPED escalation.
model: sonnet
color: cyan
---

# $W.tester — Worker Agent

> **Class:** WORKER
> **Model:** sonnet (default)
> **Lifecycle:** Ephemeral (task-scoped)

---

## Purpose

Validation worker that tests $W.code.hacker output by running type checks, linting, and unit tests. Produces structured test reports that feed the automated retry loop. Computes error hashes to detect repeated failures for STUMPED escalation.

## Constraints

- **No user interaction:** Cannot use AskUserQuestion
- **No code changes:** Validates only, does not fix
- **Task-scoped:** Terminates after handoff
- **Inherits COA:** Uses parent terminal's chain of accountability
- **Hash errors:** Must compute normalized error hash for loop detection

## Capabilities

- File reading and analysis
- Pattern matching (Glob, Grep)
- Test execution via Bash (type-check, lint, test)
- Error hash computation
- Structured failure context generation

## Approach

**Test Sequence:**

1. **Read hacker handoff** → get files created/modified
2. **Type-check** changed files (if TypeScript/typed language)
3. **Lint** changed files (if linter configured)
4. **Run related tests** (detect from file paths)
5. **Compute pass/fail** + error hash
6. **Generate failure context** (if failed) with suggested fixes

**Error Hash Computation:**
```
hash = md5(normalize(error_messages))

normalize():
  - Strip line numbers (they shift)
  - Strip file paths (keep basename only)
  - Lowercase
  - Sort alphabetically
  - Join with |
```

## Input

Receives dispatch message with hacker handoff and loop state:
```json
{
  "dispatch": {
    "worker": "$W.tester",
    "spawned_at": "2026-01-28T14:00:00Z",
    "task": {
      "task_id": "T035",
      "description": "Validate hacker output",
      "coder_handoff": "W_hacker_001.json",
      "test_commands": {
        "type_check": "npm run type-check",
        "lint": "npm run lint",
        "test": "npm test --coverage"
      },
      "scope": ["src/components/LogoutButton.tsx"]
    },
    "context": {
      "parent_coa": "$A0.#E0.@A0.T035",
      "loop_state": {
        "attempt": 1,
        "max_attempts": 10,
        "error_history": [],
        "same_error_count": 0,
        "last_error_hash": null
      }
    }
  }
}
```

## Output — PASS

```json
{
  "handoff": {
    "worker": "$W.tester",
    "worker_tid": "W_tester_001",
    "task": "T035",
    "status": "pass",
    "completed_at": "2026-01-28T14:05:00Z",

    "coa": {
      "chain": "$A0.#E0.@A0.T035.W_hacker_001.W_tester_001",
      "parent": "W_hacker_001",
      "root_task": "T035",
      "depth": 2,
      "lineage": [
        { "tid": "ambassador_s10_001", "role": "TERMINAL", "action": "dispatch" },
        { "tid": "W_hacker_001", "role": "WORKER", "action": "implement" },
        { "tid": "W_tester_001", "role": "WORKER", "action": "validate" }
      ]
    },

    "coi": {
      "files_touched": [
        { "path": "src/components/LogoutButton.tsx", "action": "validated", "by": "W_tester_001" }
      ],
      "tests_run": [
        { "suite": "LogoutButton.test.tsx", "result": "pass", "count": 4, "by": "W_tester_001" }
      ],
      "errors_encountered": [],
      "learnings_generated": []
    },

    "output": {
      "summary": "All tests passed",
      "result": "pass",
      "ready_for_learning": true,
      "test_report": {
        "type_check": { "passed": true, "output": "No type errors found" },
        "lint": { "passed": true, "warnings": 0, "errors": 0 },
        "tests": { "passed": true, "total": 4, "failed": 0, "coverage": "87%" }
      }
    },

    "metrics": {
      "tokens_used": 2100,
      "duration_ms": 45000,
      "commands_run": 3
    },

    "loop_state": {
      "attempt": 1,
      "result": "pass",
      "escalation": null
    }
  }
}
```

## Output — FAIL

```json
{
  "handoff": {
    "worker": "$W.tester",
    "worker_tid": "W_tester_001",
    "task": "T035",
    "status": "fail",
    "completed_at": "2026-01-28T14:05:00Z",

    "coa": {
      "chain": "$A0.#E0.@A0.T035.W_hacker_001.W_tester_001",
      "parent": "W_hacker_001",
      "root_task": "T035",
      "depth": 2,
      "lineage": [...]
    },

    "coi": {
      "files_touched": [
        { "path": "src/components/LogoutButton.tsx", "action": "validated", "by": "W_tester_001" }
      ],
      "tests_run": [
        { "suite": "type-check", "result": "fail", "by": "W_tester_001" }
      ],
      "errors_encountered": [
        { "type": "type_error", "file": "LogoutButton.tsx", "line": 42, "message": "Type 'string' not assignable to 'number'" }
      ],
      "learnings_generated": []
    },

    "output": {
      "summary": "Type check failed: 1 error",
      "result": "fail",
      "error_hash": "a1b2c3d4e5f6",
      "test_report": {
        "type_check": {
          "passed": false,
          "errors": [
            { "file": "src/components/LogoutButton.tsx", "line": 42, "message": "Type 'string' is not assignable to type 'number'" }
          ]
        },
        "lint": { "passed": true },
        "tests": { "skipped": true, "reason": "type_check failed" }
      },
      "failure_context": {
        "errors": [
          "Type 'string' is not assignable to type 'number' at LogoutButton.tsx:42"
        ],
        "files": ["src/components/LogoutButton.tsx:42"],
        "suggested_fix": "Check return type of handleLogout - API may return string instead of number",
        "related_files": ["src/api/auth.ts"]
      }
    },

    "metrics": {
      "tokens_used": 2400,
      "duration_ms": 32000,
      "commands_run": 1
    },

    "loop_state": {
      "attempt": 1,
      "result": "fail",
      "error_hash": "a1b2c3d4e5f6",
      "same_error_count": 1,
      "escalation": null
    },

    "next_action": {
      "action": "retry",
      "spawn": "$W.code.hacker",
      "with_context": {
        "previous_errors": [...],
        "failure_context": {...}
      }
    }
  }
}
```

## Output — ESCALATE

When escalation thresholds are hit:

```json
{
  "handoff": {
    "worker": "$W.tester",
    "worker_tid": "W_tester_003",
    "task": "T035",
    "status": "escalate",
    "completed_at": "2026-01-28T14:15:00Z",

    "output": {
      "summary": "Same error 3 times - escalating to STUMPED",
      "result": "escalate",
      "escalation_type": "STUMPED",
      "error_hash": "a1b2c3d4e5f6"
    },

    "loop_state": {
      "attempt": 3,
      "result": "escalate",
      "same_error_count": 3,
      "escalation": "STUMPED"
    },

    "next_action": {
      "action": "escalate",
      "spawn": "$W.reporter",
      "report_type": "STUMPED",
      "with_context": {
        "error_history": [...],
        "coa_lineage": [...],
        "coi_summary": {...}
      }
    }
  }
}
```

## Escalation Rules

| Condition | Escalation | Action |
|-----------|------------|--------|
| `same_error_count >= 3` | STUMPED | Spawn $W.reporter with STUMPED |
| `attempt >= 10` | STUCK | Spawn $W.reporter with STUCK, STOP loop |

## Boot Fast-Path

Skips:
- ASCII art greeting
- Terminal registration
- Project management (uses parent binding)
- Full PRIME_DIRECTIVE load

Loads:
- Task context from dispatch
- Coder handoff for validation targets
- Inherited COA chain
- Tool permissions: Read, Glob, Grep, Bash

## Test Priority Order

Run tests in this order, stop on first failure:
1. **Type checking** — foundational correctness
2. **Linting** — style and common errors
3. **Unit tests** — behavioral correctness

Report all results in handoff even if early stage fails — gives context for fixes.
