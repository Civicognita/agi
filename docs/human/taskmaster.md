# Taskmaster: Background Work Guide

Taskmaster is Aionima's background task engine. When you ask Aionima to handle something that takes time — writing documentation, reviewing code, running analysis — Taskmaster handles it in the background so you can keep working without waiting.

---

## How Taskmaster Works

When the agent decides a task is better handled asynchronously, it dispatches a background job to Taskmaster. Taskmaster assigns the job to a specialist worker, runs it, and reports back when done.

You do not need to do anything to start this process. The agent handles dispatch automatically based on the task.

---

## Tracking Jobs

Active and recent jobs appear in two places:

**Notification area** — A brief summary appears when a job starts, reaches a checkpoint, or completes.

**Gateway > Workflows** — The full work queue. Each job shows its description, current status, the worker running it, and the result when finished. You can approve or reject checkpoint jobs from this page.

Job statuses:

| Status | Meaning |
|--------|---------|
| Pending | Queued, not yet started |
| Running | Worker is actively processing |
| Checkpoint | Paused — waiting for your approval to continue |
| Complete | Finished successfully |
| Failed | Encountered an error |

---

## Worker Types

Taskmaster has specialist workers organized by domain. The agent picks the right worker for the task.

| Domain | Workers | What they handle |
|--------|---------|-----------------|
| Code | Engineer, Hacker, Reviewer, Tester | Architecture specs, implementation, review, testing |
| Knowledge | Analyst, Cryptologist, Librarian, Linguist | Research, data analysis, cataloging, terminology |
| Communication | Writer (Tech), Writer (Policy), Editor | Documentation, governance docs, editing |
| Strategy | Planner, Prioritizer | Planning, backlog ordering |
| Operations | Deployer, Custodian, Syncer | Releases, cleanup, sync |
| Governance | Auditor, Archivist | Compliance review, record keeping |
| Data | Modeler, Migrator | Schema design, data migrations |
| UX | Designer (Web), Designer (CLI) | Interface and component design |

Some workers always trigger a follow-up. For example, every Writer is always followed by an Editor — you will see both jobs appear in the queue for the same task.

---

## Approving or Rejecting Checkpoints

Some jobs pause before a significant step and ask for your review. This happens for tasks that are risky, irreversible, or where human judgment adds value — deployments, migrations, security-related changes.

When a job reaches a checkpoint:

1. A notification appears in the dashboard.
2. The job appears in **Gateway > Workflows** with status **Checkpoint**.
3. Review the job description and any output shown.
4. Click **Approve** to let the job continue, or **Reject** to stop it.

If you reject a job, it stops immediately. No further work is done. You can ask the agent to re-do the task if needed.

---

## Configuration

Taskmaster settings are in **Gateway > Settings > Gateway** under the Workers section.

| Setting | What it does |
|---------|-------------|
| Auto-approve checkpoints | Skip the approval step — jobs continue automatically. Convenient for trusted workflows; use with care. |
| Max concurrent jobs | How many background jobs can run at the same time (default: 3). Increase for faster parallel work, decrease if the host is resource-constrained. |
| Worker timeout | How long a single worker can run before being considered stuck (default: 5 minutes). |
| Model overrides | Assign a different AI model to specific worker types — for example, use a more capable model for code generation. |

Changes take effect immediately without restarting the gateway.
