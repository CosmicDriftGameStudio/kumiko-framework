---
status: reference
verified: 2026-10-19
evidence: "packages/cli/src/commands/project.ts, packages/framework/src/pipeline/projection-rebuild.ts, pipeline/msp-rebuild.ts, migrations/pending-rebuilds.ts, schema-cli.ts, bundled-features/src/jobs/handlers/projection-rebuild.job.ts"
---

# Rebuilding projections from the event log

A projection (read model table) is derived state. `kumiko_events` is the source of truth, so a
broken, empty or stale projection is repaired by replaying the log, never by editing the table.
This runbook lists the tools that exist and when to use which. It does not delete or change any
event.

Never write to `kumiko_events`, `kumiko_snapshots` or `kumiko_archived_streams` with SQL. The
guard `packages/guards/src/guard-event-store-writes.ts` exists because those writes bypass the
version-unique index, archive markers and tenant boundary.

## 1. Look before you rebuild (read-only)

Run from the app directory with `DATABASE_URL` set. The commands read `kumiko.config.ts` in the
current directory (`packages/cli/src/commands/project.ts`, `consumer.ts`).

```bash
bun kumiko project list              # name, status, source, last rebuild
bun kumiko project status <name>     # status, last event id, last error
bun kumiko consumer list             # cursor, attempts, error per event consumer
```

`project list` shows single-stream projections only (implicit ones are hidden). Multi-stream
projections (MSP) are event consumers: look at them with `consumer list` and `consumer status`.

## 2. Rebuild one projection

Both single-stream and multi-stream projections rebuild online: a shadow table is built in a
private schema, the log is replayed into it, and the result is swapped into `public` in one
transaction. If any apply throws, everything rolls back and the live table is untouched; the
state row records `failed` and `lastError`. The fence at the end holds `ACCESS EXCLUSIVE` on the
live table for a moment (`fenceLockTimeoutMs`, default 5 s, then the rebuild fails instead of
hanging).

Pick the tool that fits:

| Situation | Tool | Why |
| --- | --- | --- |
| Single-stream projection, including PII and blind-indexed columns | `bun kumiko project rebuild <name>` | Prints events processed and duration; wires the KMS and blind-index key from the env (`PLATFORM_KEK`, `SUBJECT_KEYS_DATABASE_URL`, `KUMIKO_BLIND_INDEX_KEY`) |
| Any multi-stream projection | Job `jobs:job:projection-rebuild` | Runs inside the booted app |
| After a migration that flagged tables | `bunx kumiko-schema apply` | Drains `kumiko_pending_rebuilds`, retries failed ones |
| After the PII backfill | `bun kumiko ops backfill-pii --rebuild` | Rebuilds exactly the PII projections, see [pii-event-backfill](https://github.com/CosmicDriftGameStudio/infra/blob/main/docs/runbooks/pii-event-backfill.md) |

`kumiko project rebuild` resolves the KMS wiring from the env like `schema apply` and
`ops backfill-pii` do (fw#3091), so run it with the app env of the target. If the app has PII or
blind-indexed fields and the crypto env is missing, the command aborts, because a plaintext rebuild
would null the blind-index columns. Only `--allow-plaintext-pii <reason>` (non-empty reason) lets it
continue, for apps that deliberately store plaintext. It also rejects multi-stream projections
("not registered"). Use the job for those.

### Job route (needs the `jobs` feature)

The job is manual (`trigger: { manual: true }`). Start it as `SystemAdmin` with the write handler
`jobs:write:trigger`:

```json
{ "jobName": "jobs:job:projection-rebuild", "payload": { "projection": "<name>" } }
```

The jobs admin screen offers the same through its trigger form
(`docs/reference/migration-guide.md`, "job-runs"). The run shows up in `jobs:query:list` with its
logs. Without the `jobs` feature there is no job; use the CLI row of the table above.

### Multi-stream projections

`rebuildMultiStreamProjection` resets the consumer cursor, replays in event order and hands the
cursor back to the live dispatcher with the open id gaps (`msp-rebuild.ts`). A projection without
a backing table (webhooks, notifications) cannot be rebuilt on purpose: replay would repeat the
side effects. Use `consumer skip` or `consumer restart` for those, see
[dead-letter](./dead-letter.md).

## 3. A poison event blocks the rebuild

By default the first throwing apply aborts the rebuild and rolls it back. The projection then
stays as it was and `project status <name>` shows `failed` with the error. Two ways out:

1. Fix the cause (apply code or an `r.eventMigration` upcaster) and rebuild again. Preferred.
2. Quarantine run: payload `{ "projection": "<name>", "skipApplyErrors": true }` on the job.
   Each failing apply is rolled back to a savepoint, written to `kumiko_rebuild_dead_letters` and
   skipped. The projection then knowingly lacks those events. Multi-stream projections ignore
   the flag and take `msp.errorMode.rebuild` from their declaration. Inspect and follow up in
   [dead-letter](./dead-letter.md).

## 4. After the rebuild

- `bun kumiko project status <name>` shows `idle` and a fresh `last rebuild`.
- The run logs `columnDriftCount` rows (live rows whose columns differ from the replayed shadow)
  as a warning. It does not block the swap; replay wins. Look at the sample if it is unexpected.
- If events were pruned with `pruneEvents`, the replay cannot bring back what they carried. Prune
  only aggregate types whose projections you can afford to lose.

## What has no tooling

- No command rebuilds all projections at once; run one per projection. `bunx kumiko-schema apply`
  covers the ones a migration queued.
- No CLI flag for quarantine mode (`skipApplyErrors`); only the job payload and the
  `errorPolicy` option of `rebuildProjection` carry it.
- No admin screen for projection state or for consumer cursors.
