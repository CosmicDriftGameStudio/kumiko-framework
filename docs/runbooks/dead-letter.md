---
status: reference
verified: 2026-10-19
evidence: "pipeline/event-dispatcher.ts, event-dispatcher-delivery.ts, event-dispatcher-admin.ts, event-consumer-state.ts, event-store/rebuild-dead-letter.ts, upcaster-dead-letter.ts, upcaster.ts, packages/cli/src/commands/consumer.ts"
---

# Dead letters: stuck consumers, quarantined rebuild events, failed upcasts

"Dead letter" means three different things in Kumiko. Find yours first, then follow its section.
None of them deletes an event; the log stays intact.

| Kind | Where it lives | Tooling |
| --- | --- | --- |
| Dead event consumer (SSE, search, multi-stream projection) | row in `kumiko_event_consumers`, `status = 'dead'` | `bun kumiko consumer ...` |
| Events skipped during a projection rebuild | table `kumiko_rebuild_dead_letters` | read function only |
| Events whose upcaster threw | table `kumiko_upcaster_dead_letters` | read function only |

## 1. Dead consumer

The dispatcher delivers events in id order. A handler that throws stops the pass at that event,
the cursor stays on the last good event and `attempts` climbs. At `maxAttempts` (default 10) the
consumer is marked `dead` and parked. A dead consumer is revived automatically after a cooldown
(default 5 minutes), at most 3 times in a row (`DEFAULT_REARM_COOLDOWN_MS`,
`DEFAULT_MAX_REARM_COUNT` in `event-dispatcher.ts`). A poison event never advances the cursor, so
after the third revival the consumer stays dead until someone acts.

Inspect (read-only, from the app directory with `DATABASE_URL` set):

```bash
bun kumiko consumer list
bun kumiko consumer status <consumer-name>   # status, cursor, attempts, last error
```

Then choose, from `packages/cli/src/commands/consumer.ts` and `event-dispatcher-admin.ts`:

| Command | Effect | Use when |
| --- | --- | --- |
| `consumer restart <name>` | `dead` to `idle`, retries the same event | The failure was transient (outage, deploy). Fails on a consumer that is not dead. |
| `consumer skip <name>` | Moves the cursor past the failing event, resets attempts | The event can never succeed (broken payload, removed feature code). The consumer then never sees that event. |
| `consumer disable <name>` | Dispatcher ignores the consumer | You need it quiet while you fix code. Disabled consumers are exempt from the retention lag check. |
| `consumer enable <name>` | `disabled` to `idle` | Back from disable. Fails on any other status. |

`skip` takes the id recorded in `last_failed_event_id`; without it, it falls back to the next
event after the cursor. It keeps ids in the invisible window as a pending gap instead of losing
them. If the cursor is already at the head it does nothing. All four commands default to the
shared row; per-instance consumers need their `instance_id`, which the CLI does not expose (the
functions `restartConsumer`, `skipPoisonEvent` and others take it as a third argument).

A consumer whose declaration sets `errorPolicy.skipApplyErrors` never goes dead: it logs a
warning `event-dispatcher: <name> skipped event <id>` and continues. Search the logs for that
line to find what it dropped. There is no table for these skips.

After `skip`, a projection fed by that consumer lacks the event. Rebuild it once the cause is
fixed, see [event-rebuild](./event-rebuild.md).

## 2. Rebuild dead letters (`kumiko_rebuild_dead_letters`)

Written only by a rebuild in quarantine mode (which creates the table on first use), see [event-rebuild](./event-rebuild.md) section 3.
Columns: `projection_name`, `event_id`, `tenant_id`, `aggregate_id`, `aggregate_type`,
`event_type`, `error_message`, `payload`, `created_at`. The same event can appear several times
across rebuild attempts.

- Inspect: `listRebuildDeadLetters(db, { projectionName?, limit? })` from
  `@cosmicdrift/kumiko-framework/event-store` (default limit 100, newest first). Or query the
  table with `SELECT` in `psql`.
- Replay: there is no replay command. Fix the apply code or add an upcaster, then run a normal
  (strict) rebuild of that projection; it reads the event log, not this table.
- Discard: there is no discard command and no retention job for this table. The rows are
  diagnostic only and do not affect the projection. Do not `DELETE` them by hand without
  agreeing it first; nothing in the framework depends on their absence.

## 3. Upcaster dead letters (`kumiko_upcaster_dead_letters`)

`upcastStoredEvent` walks an old payload through the `r.eventMigration` chain. With
`errorPolicy: "quarantine"` it writes a failing event here and skips it instead of throwing.
In the current code nothing outside `event-store/` sets that policy or calls
`createUpcasterDeadLetterTable`, and no migration creates the table. So in a normal app the table
does not exist and a failing upcaster surfaces as a thrown error in the consumer (section 1) or
the rebuild ([event-rebuild](./event-rebuild.md) section 3).

If you do have the table: `listDeadLetters(db, { eventType?, limit? })` reads it. A replay is
not implemented (the source says so). Fix the migration, then rebuild.

## What has no tooling

- No replay or discard for either dead-letter table, and no CLI to list them.
- No CLI for per-instance consumers (`--instance-id`).
- No table or CLI listing events skipped by `errorPolicy.skipApplyErrors` on a live consumer;
  only the warn log.
- No admin screen for consumers or dead letters.
