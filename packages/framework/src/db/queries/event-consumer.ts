import type { ConsumerStatuses, PendingGapEntry } from "../../pipeline/event-consumer-state.js";
import type { AnyDb } from "../query.js";
import { asRawClient } from "../query.js";

// Per-turn snapshot bounds for pending-gap finality (event-dispatcher.ts's
// processConsumer). pg_current_snapshot() is this transaction's MVCC view;
// xmin is the oldest still-in-progress xact id in it, xmax the next
// unassigned one. Both travel as strings — bigint/xid8 doesn't round-trip
// through the driver as a JS number.
export async function selectSnapshotXmin(db: AnyDb): Promise<string> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`,
  )) as ReadonlyArray<{ xmin: string }>;
  const xmin = rows[0]?.xmin;
  if (xmin === undefined) throw new Error("selectSnapshotXmin: no row returned");
  return xmin;
}

export async function selectSnapshotXmax(db: AnyDb): Promise<string> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS xmax`,
  )) as ReadonlyArray<{ xmax: string }>;
  const xmax = rows[0]?.xmax;
  if (xmax === undefined) throw new Error("selectSnapshotXmax: no row returned");
  return xmax;
}

/** Serialise against consumer-bootstrap INSERTs during event retention prune. */
export async function lockEventConsumersShareMode(db: AnyDb): Promise<void> {
  await asRawClient(db).unsafe(`LOCK TABLE "kumiko_event_consumers" IN SHARE MODE`);
}

// The MAX(id) horizon plus every currently-open id gap below it, read from a
// single statement snapshot. Used both to seed startFrom "now" (#3231) and to
// seed an MSP rebuild's handoff to the live dispatcher (msp-rebuild.ts).
//
// Scan lower bound: the consumer with the highest cursor already tracks every
// open gap at or below that cursor in its own pending_gaps, so those are taken
// over verbatim (keeping their xmax) and only ids above the cursor are scanned,
// with the cursor itself as virtual predecessor. Without any consumer the
// cursor is 0 and the scan covers the whole table. No bound derived from xmin or
// id margins: ids and xids interleave, so such a bound cannot be proven safe.
// Above the cursor a gap can only fill in if some transaction holding a lower id
// is still in flight, which pg_snapshot_xip being empty rules out, so the window
// scan is skipped then.
export async function selectEventIdHorizonWithMissingRanges(
  db: AnyDb,
): Promise<{ readonly horizon: bigint; readonly gaps: PendingGapEntry[] }> {
  const rows = (await asRawClient(db).unsafe(
    `WITH a AS (
       SELECT "last_processed_event_id" AS cursor, "pending_gaps" AS gaps
         FROM "kumiko_event_consumers"
        ORDER BY "last_processed_event_id" DESC
        LIMIT 1
     ),
     c AS (SELECT COALESCE((SELECT cursor FROM a), 0) AS v),
     b AS (SELECT COALESCE(MAX("id"), 0) AS horizon FROM "kumiko_events"),
     r AS (
       SELECT (g ->> 'from')::bigint AS f, (g ->> 'to')::bigint AS t, g ->> 'xmax' AS x
         FROM a,
              jsonb_array_elements(CASE WHEN jsonb_typeof(a.gaps) = 'array' THEN a.gaps ELSE '[]'::jsonb END) AS g
       UNION ALL
       SELECT c.v + 1, m.min_id - 1, pg_snapshot_xmax(pg_current_snapshot())::text
         FROM c,
              (SELECT MIN(e."id") AS min_id FROM "kumiko_events" e WHERE e."id" > (SELECT v FROM c)) m
        WHERE m.min_id > c.v + 1 AND EXISTS (SELECT 1 FROM pg_snapshot_xip(pg_current_snapshot()))
       UNION ALL
       SELECT w."id" + 1, w.next_id - 1, pg_snapshot_xmax(pg_current_snapshot())::text
         FROM (SELECT e."id", lead(e."id") OVER (ORDER BY e."id") AS next_id
                 FROM "kumiko_events" e WHERE e."id" > (SELECT v FROM c)) w
        WHERE w.next_id > w."id" + 1 AND EXISTS (SELECT 1 FROM pg_snapshot_xip(pg_current_snapshot()))
     )
     SELECT b.horizon::text AS horizon,
            r.f::text AS gap_from,
            r.t::text AS gap_to,
            r.x AS gap_xmax
       FROM b LEFT JOIN r ON true
      ORDER BY r.f`,
  )) as ReadonlyArray<{
    horizon: string;
    gap_from: string | null;
    gap_to: string | null;
    gap_xmax: string | null;
  }>;
  const first = rows[0];
  if (first === undefined)
    throw new Error("selectEventIdHorizonWithMissingRanges: no row returned");
  const gaps: PendingGapEntry[] = [];
  for (const row of rows) {
    if (row.gap_from === null || row.gap_to === null || row.gap_xmax === null) continue;
    gaps.push({ from: row.gap_from, to: row.gap_to, xmax: row.gap_xmax });
  }
  return { horizon: BigInt(first.horizon), gaps };
}

// startFrom "now" seeds the FIRST-registration cursor at the current
// MAX(events.id) instead of the column default 0 — mounting a consumer into
// an existing app then skips the historical log instead of replaying it. The
// horizon and pending_gaps are read from one snapshot (selectEventIdHorizon
// WithMissingRanges): a transaction holding a lower id can still be
// in-flight at boot, and without seeding those gaps its event would commit
// after the cursor already sits above it, so `id > cursor` would never
// deliver it (#3231). The cheap existence check skips the scan entirely for
// the (overwhelmingly common) case of an already-registered consumer.
// ON CONFLICT DO NOTHING keeps both branches safe for an existing row: the
// subquery only ever affects the row this statement inserts.
export async function insertConsumerIfAbsent(
  db: AnyDb,
  name: string,
  instanceId: string,
  startFrom: "beginning" | "now" = "beginning",
): Promise<void> {
  if (startFrom === "now") {
    const existing = (await asRawClient(db).unsafe(
      `SELECT 1 FROM "kumiko_event_consumers" WHERE "name" = $1 AND "instance_id" = $2`,
      [name, instanceId],
    )) as ReadonlyArray<unknown>;
    // skip: already registered — an existing cursor is never re-seeded.
    if (existing.length > 0) return;
    const { horizon, gaps } = await selectEventIdHorizonWithMissingRanges(db);
    await asRawClient(db).unsafe(
      `INSERT INTO "kumiko_event_consumers" ("name", "instance_id", "status", "last_processed_event_id", "pending_gaps")
       VALUES ($1, $2, 'idle', $3, $4::text::jsonb)
       ON CONFLICT ("name", "instance_id") DO NOTHING`,
      [name, instanceId, horizon, JSON.stringify(gaps)],
    );
  } else {
    await asRawClient(db).unsafe(
      `INSERT INTO "kumiko_event_consumers" ("name", "instance_id", "status") VALUES ($1, $2, 'idle')
       ON CONFLICT ("name", "instance_id") DO NOTHING`,
      [name, instanceId],
    );
  }
}

// Lock-free pre-check for doPass: which (name, instance_id) pairs are
// provably idle — no locking, no xid, no WAL. A pair only qualifies when its
// row exists, its status isn't dead (dead must still go through
// acquireConsumerState for auto-rearm), it has no pending_gaps, and no event
// exists past its cursor. Paired via unnest so the two positional arrays
// zip element-wise into rows instead of a cartesian product.
//
// `deadStatus` is passed in rather than imported as a value from
// event-consumer-state.ts (which defines ConsumerStatuses) — that module
// already imports from this one, so a value import back would be a require
// cycle. The
// type-only import keeps the parameter pinned to the "dead" literal.
export async function selectProvablyIdleConsumerPairs(
  db: AnyDb,
  names: readonly string[],
  instanceIds: readonly string[],
  deadStatus: typeof ConsumerStatuses.dead,
): Promise<ReadonlyArray<{ readonly name: string; readonly instanceId: string }>> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT c."name" AS name, c."instance_id" AS instance_id
     FROM "kumiko_event_consumers" c
     WHERE ("name", "instance_id") = ANY (SELECT * FROM unnest($1::text[], $2::text[]))
       AND "status" != $3
       AND "pending_gaps" = '[]'::jsonb
       AND NOT EXISTS (
         SELECT 1 FROM "kumiko_events" e WHERE e."id" > c."last_processed_event_id"
       )`,
    [names, instanceIds, deadStatus],
  )) as ReadonlyArray<{ name: string; instance_id: string }>;
  return rows.map((r) => ({ name: r.name, instanceId: r.instance_id }));
}

export async function selectConsumerForUpdateSkipLocked(
  db: AnyDb,
  name: string,
  instanceId: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT * FROM "kumiko_event_consumers" WHERE "name" = $1 AND "instance_id" = $2 FOR UPDATE SKIP LOCKED`,
    [name, instanceId],
  )) as ReadonlyArray<Record<string, unknown>>;
  return rows[0];
}

export async function markConsumerProcessing(
  db: AnyDb,
  name: string,
  instanceId: string,
): Promise<void> {
  await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET "status" = 'processing', "updated_at" = now()
     WHERE "name" = $1 AND "instance_id" = $2`,
    [name, instanceId],
  );
}

// Best-effort record of an infra-level pass failure (event-dispatcher.ts's
// processConsumer catch) — called OUTSIDE the transaction that just rolled
// back, since that tx's own markProcessing/updateConsumerDeliveryOutcome
// writes never committed. Must NOT touch "attempts": that counter is
// deliverEvents' poison-pill/dead-letter budget, incremented only on a
// handler throw inside an actual delivery pass. Spending it here would let
// repeated infra blips (the exact case this backoff exists for) dead-letter
// the consumer on the next real handler failure instead of after
// maxAttempts. Visibility is covered by last_error, updated_at, and the
// caller's console.error — status and the cursor are left as-is too, since
// we don't know at this point whether the consumer should be "dead" (that's
// the deliverEvents/maxAttempts contract, which never ran this pass).
//
// Another replica sharing this (name, instance_id) may commit a successful
// pass between the rollback and this write. `cursorBeforePass` pins the
// write to the state the failed pass started from, so a stale error can't
// overwrite that success; a row another pass currently holds is skipped
// instead of blocking this catch path on its lock. Undefined when the pass
// failed before it read the cursor.
export async function recordConsumerPassFailure(
  db: AnyDb,
  name: string,
  instanceId: string,
  errorMessage: string,
  cursorBeforePass?: bigint,
): Promise<void> {
  await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET
       "last_error" = $1,
       "updated_at" = now()
     WHERE "name" = $2 AND "instance_id" = $3
       AND ($4::bigint IS NULL OR "last_processed_event_id" = $4::bigint)
       AND ("name", "instance_id") IN (
         SELECT "name", "instance_id" FROM "kumiko_event_consumers"
         WHERE "name" = $2 AND "instance_id" = $3
         FOR UPDATE SKIP LOCKED
       )`,
    [errorMessage, name, instanceId, cursorBeforePass ?? null],
  );
}

export type ConsumerDeliveryOutcome = {
  readonly cursor: bigint;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly deadLettered: boolean;
  readonly processed: number;
  readonly pendingGaps: readonly PendingGapEntry[];
  readonly failedEventId: bigint | null;
};

export async function updateConsumerDeliveryOutcome(
  db: AnyDb,
  name: string,
  instanceId: string,
  outcome: ConsumerDeliveryOutcome,
): Promise<void> {
  // Advancing the cursor proves this pass wasn't poison — reset the re-arm
  // budget so an unrelated failure down the line gets its own fresh 3
  // chances instead of inheriting a partially-spent counter from a past,
  // already-resolved outage.
  const resetRearmCount = outcome.processed > 0;
  await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET
       "last_processed_event_id" = $1,
       "attempts" = $2,
       "status" = $3,
       "last_error" = $4,
       "rearm_count" = CASE WHEN $5 THEN 0 ELSE "rearm_count" END,
       -- text param + cast: a JS string bound straight to ::jsonb double-encodes under Bun.SQL
       "pending_gaps" = $6::text::jsonb,
       "last_failed_event_id" = $9,
       "updated_at" = now()
     WHERE "name" = $7 AND "instance_id" = $8`,
    [
      outcome.cursor,
      outcome.attempts,
      outcome.deadLettered ? "dead" : "idle",
      outcome.lastError,
      resetRearmCount,
      JSON.stringify(outcome.pendingGaps),
      name,
      instanceId,
      outcome.failedEventId,
    ],
  );
}

export async function updateConsumerStatusReturning(
  db: AnyDb,
  name: string,
  instanceId: string,
  status: "idle" | "disabled",
): Promise<Record<string, unknown> | undefined> {
  const rows = (await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET "status" = $1, "attempts" = 0, "last_error" = NULL, "rearm_count" = 0, "updated_at" = now()
     WHERE "name" = $2 AND "instance_id" = $3
     RETURNING *`,
    [status, name, instanceId],
  )) as ReadonlyArray<Record<string, unknown>>;
  return rows[0];
}

export async function advanceConsumerPastEventReturning(
  db: AnyDb,
  name: string,
  instanceId: string,
  eventId: bigint,
  // Full list, including ids skipped over between the old cursor and eventId that were not visible yet.
  pendingGaps: readonly PendingGapEntry[],
): Promise<Record<string, unknown> | undefined> {
  const rows = (await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET
       "last_processed_event_id" = $1,
       "status" = 'idle',
       "attempts" = 0,
       "last_error" = NULL,
       "rearm_count" = 0,
       "last_failed_event_id" = NULL,
       -- text param + cast: a JS string bound straight to ::jsonb double-encodes under Bun.SQL
       "pending_gaps" = $4::text::jsonb,
       "updated_at" = now()
     WHERE "name" = $2 AND "instance_id" = $3
     RETURNING *`,
    [eventId, name, instanceId, JSON.stringify(pendingGaps)],
  )) as ReadonlyArray<Record<string, unknown>>;
  return rows[0];
}

export async function resetConsumerForMspRebuild(
  db: AnyDb,
  name: string,
  instanceId: string,
): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_event_consumers" ("name", "instance_id", "last_processed_event_id", "status", "pending_gaps")
     VALUES ($1, $2, 0, 'idle', '[]'::jsonb)
     ON CONFLICT ("name", "instance_id") DO UPDATE SET
       "last_processed_event_id" = 0,
       "status" = 'idle',
       "attempts" = 0,
       "last_error" = NULL,
       "pending_gaps" = '[]'::jsonb,
       "last_failed_event_id" = NULL,
       "updated_at" = now()`,
    [name, instanceId],
  );
}

export async function selectConsumerForUpdate(
  db: AnyDb,
  name: string,
  instanceId: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT * FROM "kumiko_event_consumers" WHERE "name" = $1 AND "instance_id" = $2 FOR UPDATE`,
    [name, instanceId],
  )) as ReadonlyArray<Record<string, unknown>>;
  return rows[0];
}

export async function updateConsumerRebuildCursor(
  db: AnyDb,
  name: string,
  instanceId: string,
  lastProcessedEventId: bigint,
  pendingGaps: readonly PendingGapEntry[],
): Promise<void> {
  await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET
       "last_processed_event_id" = $1,
       "status" = 'idle',
       "attempts" = 0,
       "last_error" = NULL,
       -- text param + cast: a JS string bound straight to ::jsonb double-encodes under Bun.SQL
       "pending_gaps" = $2::text::jsonb,
       "last_failed_event_id" = NULL,
       "updated_at" = now()
     WHERE "name" = $3 AND "instance_id" = $4`,
    [lastProcessedEventId, JSON.stringify(pendingGaps), name, instanceId],
  );
}

export async function markConsumerRebuildFailed(
  db: AnyDb,
  name: string,
  instanceId: string,
  errorMessage: string,
): Promise<void> {
  await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET "status" = 'dead', "last_error" = $1, "updated_at" = now()
     WHERE "name" = $2 AND "instance_id" = $3`,
    [errorMessage, name, instanceId],
  );
}

// Auto-revive a dead consumer once its cooldown has elapsed (called from
// acquireConsumerState — not an ops action, so no "requireConsumerRow"
// precondition like restartConsumer/enableConsumer). Increments rearm_count
// so the caller can enforce a lifetime cap on automatic revivals; manual
// restartConsumer()/enableConsumer() reset it back to 0.
export async function rearmDeadConsumer(
  db: AnyDb,
  name: string,
  instanceId: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = (await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET
       "status" = 'idle',
       "attempts" = 0,
       "last_error" = NULL,
       "rearm_count" = "rearm_count" + 1,
       "updated_at" = now()
     WHERE "name" = $1 AND "instance_id" = $2
     RETURNING *`,
    [name, instanceId],
  )) as ReadonlyArray<Record<string, unknown>>;
  return rows[0];
}

// skipPoisonEvent's pending-gap branch: the poison is a pending id below the
// cursor, so it's removed from pending_gaps directly instead of advancing
// last_processed_event_id (advancing it here would be a regression — the
// cursor already sits above this id).
export async function removePendingGapReturning(
  db: AnyDb,
  name: string,
  instanceId: string,
  newPendingGaps: readonly PendingGapEntry[],
): Promise<Record<string, unknown> | undefined> {
  const rows = (await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET
       "pending_gaps" = $1::text::jsonb,
       "status" = 'idle',
       "attempts" = 0,
       "last_error" = NULL,
       "rearm_count" = 0,
       "last_failed_event_id" = NULL,
       "updated_at" = now()
     WHERE "name" = $2 AND "instance_id" = $3
     RETURNING *`,
    [JSON.stringify(newPendingGaps), name, instanceId],
  )) as ReadonlyArray<Record<string, unknown>>;
  return rows[0];
}
