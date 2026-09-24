import type { PendingGapEntry } from "../../pipeline/event-consumer-state";
import type { AnyDb } from "../query";
import { asRawClient } from "../query";

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
// single snapshot (READ COMMITTED gives each statement its own). A gap can
// only later fill in if some transaction holding a lower id was still
// in-flight in that same snapshot — pg_snapshot_xip is empty otherwise, so
// the gap CTEs short-circuit and the window scan over kumiko_events never
// runs. Used both to seed startFrom "now" (#3231) and to seed an MSP
// rebuild's handoff to the live dispatcher (msp-rebuild.ts).
export async function selectEventIdHorizonWithMissingRanges(
  db: AnyDb,
): Promise<{ readonly horizon: bigint; readonly gaps: PendingGapEntry[] }> {
  const rows = (await asRawClient(db).unsafe(
    `WITH b AS (
       SELECT COALESCE(MAX("id"), 0) AS horizon, MIN("id") AS min_id FROM "kumiko_events"
     ),
     r AS (
       SELECT 1::bigint AS f, b.min_id - 1 AS t FROM b
        WHERE b.min_id > 1 AND EXISTS (SELECT 1 FROM pg_snapshot_xip(pg_current_snapshot()))
       UNION ALL
       SELECT w."id" + 1, w.next_id - 1
         FROM (SELECT "id", lead("id") OVER (ORDER BY "id") AS next_id FROM "kumiko_events") w
        WHERE w.next_id > w."id" + 1 AND EXISTS (SELECT 1 FROM pg_snapshot_xip(pg_current_snapshot()))
     )
     SELECT b.horizon::text AS horizon,
            pg_snapshot_xmax(pg_current_snapshot())::text AS xmax,
            r.f::text AS gap_from,
            r.t::text AS gap_to
       FROM b LEFT JOIN r ON true
      ORDER BY r.f`,
  )) as ReadonlyArray<{
    horizon: string;
    xmax: string;
    gap_from: string | null;
    gap_to: string | null;
  }>;
  const first = rows[0];
  if (first === undefined)
    throw new Error("selectEventIdHorizonWithMissingRanges: no row returned");
  const gaps: PendingGapEntry[] = [];
  for (const row of rows) {
    if (row.gap_from === null || row.gap_to === null) continue;
    gaps.push({ from: row.gap_from, to: row.gap_to, xmax: row.xmax });
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

// fw#2625: a consumer that moved from delivery: "per-instance" to "shared"
// leaves its old per-instance rows behind — no dispatcher will ever advance
// them again, and pruneEvents stays pinned to their stale cursor forever.
// Scoped by name + "not the shared sentinel" so a still-per-instance
// consumer's live rows (or an already-migrated __shared__ row) are never
// touched.
export async function deleteOrphanedPerInstanceConsumerRows(
  db: AnyDb,
  consumerNames: readonly string[],
  // Passed in rather than imported from event-consumer-state.ts (which
  // defines SHARED_INSTANCE_SENTINEL): that module already imports from
  // this one for the DB queries it needs, so importing back would be a
  // require cycle. The one caller lives in that same file and has the
  // constant in scope.
  sharedInstanceSentinel: string,
): Promise<void> {
  // skip: nothing to delete — an empty ANY($1) would still hit the table,
  // pointlessly, on every boot for an app with no migrated consumers yet.
  if (consumerNames.length === 0) return;
  await asRawClient(db).unsafe(
    `DELETE FROM "kumiko_event_consumers"
     WHERE "name" = ANY($1) AND "instance_id" != $2`,
    [consumerNames, sharedInstanceSentinel],
  );
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
export async function recordConsumerPassFailure(
  db: AnyDb,
  name: string,
  instanceId: string,
  errorMessage: string,
): Promise<void> {
  await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET
       "last_error" = $1,
       "updated_at" = now()
     WHERE "name" = $2 AND "instance_id" = $3`,
    [errorMessage, name, instanceId],
  );
}

export type ConsumerDeliveryOutcome = {
  readonly cursor: bigint;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly deadLettered: boolean;
  readonly processed: number;
  readonly pendingGaps: readonly PendingGapEntry[];
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
): Promise<Record<string, unknown> | undefined> {
  const rows = (await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET
       "last_processed_event_id" = $1,
       "status" = 'idle',
       "attempts" = 0,
       "last_error" = NULL,
       "rearm_count" = 0,
       "updated_at" = now()
     WHERE "name" = $2 AND "instance_id" = $3
     RETURNING *`,
    [eventId, name, instanceId],
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
       "updated_at" = now()`,
    [name, instanceId],
  );
}

export async function selectConsumerForUpdate(
  db: AnyDb,
  name: string,
  instanceId: string,
): Promise<void> {
  await asRawClient(db).unsafe(
    `SELECT * FROM "kumiko_event_consumers" WHERE "name" = $1 AND "instance_id" = $2 FOR UPDATE`,
    [name, instanceId],
  );
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
       "updated_at" = now()
     WHERE "name" = $2 AND "instance_id" = $3
     RETURNING *`,
    [JSON.stringify(newPendingGaps), name, instanceId],
  )) as ReadonlyArray<Record<string, unknown>>;
  return rows[0];
}
