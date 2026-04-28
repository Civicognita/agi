---
name: dev
description: Developer workflow — file editing, shell execution, and git operations
domain: development
triggers:
  - dev mode
  - developer mode
  - write code
  - edit file
  - run command
  - git status
  - git commit
  - show diff
requires_state: [ONLINE]
requires_tier: verified
priority: 10
direct_invoke: true
---

You are operating in developer mode with access to workspace tools. Use these tools deliberately and precisely.

## Available Dev Tools

### Filesystem
- `file_read` — Read any file in the workspace by path
- `file_write` — Write or overwrite a file at a given path
- `dir_list` — List directory contents with optional depth
- `grep_search` — Search file contents using a regex pattern across the workspace

### Shell
- `shell_exec` — Execute a shell command in the workspace root. Use for: `npx tsc --noEmit`, `pnpm test`, `pnpm build`, `node`, `cat`, etc.

### Git
- `git_status` — Show working tree status (staged, unstaged, untracked)
- `git_diff` — Show diff for staged changes, a specific file, or between refs
- `git_add` — Stage files for commit (accepts paths or `.` for all)
- `git_commit` — Create a commit with a message
- `git_branch` — List, create, or switch branches

## Workspace Conventions

**Project:** TypeScript ESM monorepo, pnpm workspaces, Node >=22

**Import style:**
- Always use `.js` extensions in import paths (ESM requires it even for `.ts` sources)
- Use named exports; avoid default exports in library packages
- Import types with `import type { ... }` to keep runtime clean

**File layout:**
- `packages/` — shared libraries (gateway-core, entity-model, coa-chain, channel-sdk, memory, skills)
- `channels/` — channel adapters (telegram, discord, signal, whatsapp)
- `cli/` — CLI entry points
- `config/` — runtime configuration and schema

**Testing:**
- Runner: vitest
- Test files: `*.test.ts` co-located with source
- Run all tests: `pnpm test`
- Run single package: `pnpm --filter @agi/gateway-core test`

**Type checking:**
- After edits always validate: `npx tsc --noEmit`
- Fix all type errors before committing

## Coding Guidelines

1. Read the file before editing it — never guess at existing structure
2. Make minimal, targeted changes; do not refactor surrounding code
3. Preserve existing export shapes — downstream packages depend on them
4. Do not add comments unless the logic is non-obvious
5. After writing a file, run `npx tsc --noEmit` to confirm no type errors
6. Commit with a concise imperative message: `Fix null dereference in session-manager`
