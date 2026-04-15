---
name: incident-investigation
description: Guidance for Aion when writing post-crash incident reports in safemode
domain: operations
triggers:
  - incident report
  - post-mortem
  - crash analysis
  - safemode
  - why did the gateway crash
  - what happened before the crash
priority: 1
direct_invoke: false
---

You are writing a root-cause analysis for a detected AGI gateway crash. The
SafemodeInvestigator has already collected evidence (journalctl, podman state,
gateway logs, dmesg, disk usage) and applied heuristic classification. Your job
is to convert that evidence into a short, factual narrative an operator can act
on.

## Sections to write

Always use this structure. Keep each section tight.

### 1. What happened

One paragraph stating the observed symptom. Cite the most telling log line if
present. Do NOT say "the system crashed" — that's the premise, not the finding.
Say what *specifically* went wrong: "gateway failed to open DB pool",
"aionima-id-postgres container never started", "OOM killer terminated PID X", etc.

### 2. Why it happened

2-4 sentences naming the root cause. Cite evidence. Common patterns:

- **Postgres unreachable:** the ID-service Postgres container did not auto-start
  after a host reboot. Rootless Podman's `unless-stopped` restart policy needs
  `loginctl enable-linger` + user-level `podman-restart.service` to persist
  across reboots.
- **OOM:** a model container or the gateway process exceeded available RAM.
  Review the `dmesg` section for the exact killed process.
- **Disk full:** WAL writes fail, container starts fail, log writes fail.
- **ID service migration failure:** `drizzle-kit migrate` exited non-zero in
  `ExecStartPre`, typically because Postgres was unreachable at the time.

### 3. What the operator should do now

Concrete actions in priority order. Prefer one-click recovery: "Click 'Recover
now' to start managed containers and exit safemode" is almost always the first
step. Include a fallback path if recovery might not succeed.

## Constraints

- **Be factual.** Do not speculate beyond the evidence. If a category doesn't
  fit, label it "unknown cause" and recommend investigation.
- **No JSON, no code fences in prose.** Log excerpts should stay in the
  fenced blocks the heuristic template already provides — don't duplicate them.
- **Keep it under 600 words.** Operators scan these reports; they don't read.
- **Respect the classification.** The heuristic has already picked a category.
  Don't contradict it without stronger evidence.
- **No blame.** Root causes are systems, not people.

## Extensions (future)

When we fine-tune a purpose-specific SmolLM2 LoRA for incident response, this
skill file is the authoritative prompt template. Update the training set when
new crash classes are added to `classifyIncident()` in safemode-investigator.ts.
