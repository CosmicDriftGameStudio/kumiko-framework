---
"@cosmicdrift/kumiko-framework": minor
---

Projection rebuild: live-tail catch-up (#363 Phase 2)

Single-stream `rebuildProjection` now drains the event log with a cursor-paged
catch-up loop instead of a single up-front SELECT. It replays the bulk
lock-free (live synchronous applies keep writing to the live table; READ
COMMITTED makes each fresh batch see their newly-committed events), then takes a
brief `ACCESS EXCLUSIVE` fence on the live table and drains the final delta
before the swap.

Effect: events committed to the live table **during** the replay are no longer
lost at swap — Phase 1's single-pod write-loss window is closed. The trade is a
marginally longer cutover (final-drain + swap, bounded by a `lock_timeout`)
versus Phase 1's swap-only window.

Cutover semantics: a concurrent synchronous apply blocked on the fence is one
atomic append+apply transaction. The guaranteed invariant — independent of
Postgres version — is that the event and its projection row commit or roll back
**together**: no orphaned event-without-row is possible. (Observed on PostgreSQL
18: when the fence releases, the blocked write re-resolves to the swapped-in
table by name and commits rather than erroring — but don't design around
"blocked writes always succeed"; only the atomicity is guaranteed.)

Boundary unchanged: this is **not** multi-pod zero-downtime. During a rolling
deploy, old pods still running cannot read the new shape after the swap.
End-to-end zero-downtime additionally needs app-author expand/contract
discipline (see `docs/plans/projection-aware-migrations.md`). Multi-stream
projections are unaffected — they have no inline apply, the consumer `FOR UPDATE`
already fences the dispatcher, and the cursor catches the tail after the swap.

New optional `rebuildProjection` deps: `fenceLockTimeoutMs` (cutover fence
timeout, default 5000ms).
