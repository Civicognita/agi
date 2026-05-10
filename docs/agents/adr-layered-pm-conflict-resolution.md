# ADR: Layered PM provider — conflict resolution for dual writes

**Status:** Accepted (s155 t669, 2026-05-09)
**Implementation:** s155 t672 (bidirectional layered writes — pending)
**Sibling docs:** `tynn-and-related-concepts.md`, `plan-vs-pm.md`

---

## Context

The Layered PM Provider (s155 t664) wires TynnLite alongside the
configured primary PmProvider (typically `tynn-server` MCP, future
candidates: Linear, Jira). Reads fall through on primary failure; this
ADR addresses **writes**, where the primary and TynnLite are both
authoritative for the same project.

Two policies are possible for dual writes:
- **Mirror (chosen):** every write goes to TynnLite first, then is
  forwarded to the primary. TynnLite is the **always-available floor**.
- **Primary-first with TynnLite-as-cache:** write to primary; only
  write to TynnLite if primary succeeds. TynnLite is a **read-replica**.

This ADR captures why we chose **mirror** and how conflicts get resolved.

## Decision

### Write semantics: TynnLite-first mirror

```
client → LayeredPmProvider.write(...)
  ├─ TynnLite.write(...)          ← always (synchronous, fails atomically)
  └─ primary.write(...)            ← best-effort (async, retry on failure)
```

- TynnLite is the **floor**. A failed TynnLite write fails the call.
- Primary is **best-effort**. A failed primary write enqueues a retry
  in `~/.agi/sync-queue.jsonl` and emits a soft-conflict warning.
- Reads continue to fall through on primary failure (per t664).

This makes TynnLite the source of truth from the agent's perspective:
even when the primary is unreachable, the agent's writes never
disappear. The primary catches up via retry queue when reachable.

### Conflict windows

A conflict window opens whenever the primary and TynnLite diverge:

1. **Primary unavailable during write.** Primary write fails; TynnLite
   succeeds. The retry queue carries the diff to the primary on
   reconnect. Conflict resolves automatically when the queue drains.
2. **External write to primary while it was unavailable.** Another
   client (e.g. owner via tynn web UI) updates the primary while AGI's
   primary connection is down. AGI's TynnLite has a stale snapshot and
   fresh local writes; primary has the external writes.
3. **Concurrent writes from AGI + external client.** AGI writes to
   TynnLite (succeeds) + primary (fails or succeeds without
   propagation). External client writes to primary directly. Both
   updated last-write-wins.

### Resolution policy: per-field LWW with soft-conflict surfacing

Per-record conflicts resolve via **last-write-wins per field**:
- Each tracked field carries an `updated_at_<field>` timestamp.
- On read-back from primary, AGI compares its local TynnLite copy field-
  by-field against the primary record. Fields where primary's
  `updated_at` is newer overwrite TynnLite. Fields where TynnLite is
  newer trigger a **soft conflict**.

**Soft conflicts** are non-fatal:
- Logged to `~/.agi/sync-conflicts.jsonl`
- Surfaced in dashboard PM-Lite panel as a yellow ⚠ badge per record
- Owner-resolvable via "Accept primary" / "Accept TynnLite" / "Edit"
  one-click actions — same shape as merge-conflict resolution UIs

**Hard conflicts** (status moves through invalid transitions, e.g.
TynnLite says `done` but primary says `backlog`) trigger:
- Block the field's auto-merge
- Force owner intervention via dashboard
- Dashboard surfaces the divergence with both timestamps + paths

### What is NOT in scope

- **CRDT semantics.** Per-field LWW is sufficient for single-owner
  workflows. Multi-owner CRDT (e.g. add-wins set for tags) is deferred
  until a real multi-owner scenario appears.
- **Vector clocks.** Single owner + monotonic ISO timestamps (with
  millisecond precision) are sufficient. Owner clock drift is bounded
  by NTP sync; sub-millisecond races on the same record from the same
  owner are vanishingly rare.
- **Optimistic locking on primary.** Primary's PmProvider implementation
  may have its own locking (tynn-server's `If-Match` headers); we
  surface those errors but don't second-guess them.
- **Conflict-free dual writes during VIP migrations.** Owner
  expectation per `feedback_iterative_work_discipline`: when migrating
  data shape (s130, s140), pause the loop, run the migration, resume.
  Conflict resolution does not need to handle in-flight schema drift.

## Consequences

**Positive:**
- TynnLite is always available — agent writes never vanish.
- Retry queue + per-field LWW handles the common case (primary
  intermittent unavailability) automatically.
- Owner intervention only when fields diverge in ways that cannot be
  auto-resolved — soft-conflict surfacing keeps the cost visible.

**Negative:**
- Two writes per logical operation (TynnLite + primary). Cost: ~2x
  write latency in the steady state. Mitigated by primary being async.
- TynnLite stale-after-external-primary-write windows can persist
  until the next read fetches from primary (cache invalidation
  challenge). Mitigated by AGI doing periodic background refreshes
  every N minutes when primary is reachable.
- Per-field timestamps inflate TynnLite storage by ~30% (one extra
  timestamp per tracked field). Acceptable cost.

**Neutral:**
- Conflict-resolution UI work falls on the dashboard PM-Lite panel
  (s155 t668's expansion). Not free, but UI primitive (List + ConflictRow)
  reuses existing PAx Table + Modal.

## Implementation hooks (for t672)

The implementation in s155 t672 wires:

1. `LayeredPmProvider.write()` extended to dual-write with retry queue
   on primary failure
2. `~/.agi/sync-queue.jsonl` retry queue + `~/.agi/sync-conflicts.jsonl`
   conflict log
3. Per-field timestamps (`updated_at_status`, `updated_at_title`, etc.)
   in TynnLite schema
4. Read-back diff routine that detects soft + hard conflicts on
   primary refetch
5. `/api/pm/conflicts` REST endpoint + dashboard PM-Lite panel "⚠
   Conflicts" tab + per-record resolve actions
6. Background primary-refresh worker (configurable cadence; default
   5min) so the cache doesn't go stale forever

## References

- s155 t664 (LayeredPmProvider — already shipped)
- s155 t665-t668 (plan actions + UI surface — already shipped)
- s155 t672 (bidirectional layered writes — pending; references this ADR)
- `feedback_pending_questions_owner_only` — soft-conflict UI keeps owner
  in the loop without halting the agent loop
- `feedback_tynn_workflow_is_the_agi_agentic_model` — TynnLite-as-floor
  preserves the canonical workflow shape regardless of remote provider
