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

// startFrom "now" seeds the FIRST-registration cursor at the current
// MAX(events.id) instead of the column default 0 — mounting a consumer into
// an existing app then skips the historical log instead of replaying it.
// ON CONFLICT DO NOTHING keeps both branches safe for an existing row: the
// subquery only ever affects the row this statement inserts.
export async function insertConsumerIfAbsent(
  db: AnyDb,
  name: string,
  instanceId: string,
  startFrom: "beginning" | "now" = "beginning",
): Promise<void> {
  if (startFrom === "now") {
    await asRawClient(db).unsafe(
      `INSERT INTO "kumiko_event_consumers" ("name", "instance_id", "status", "last_processed_event_id")
       VALUES ($1, $2, 'idle', COALESCE((SELECT MAX("id") FROM "kumiko_events"), 0))
       ON CONFLICT ("name", "instance_id") DO NOTHING`,
      [name, instanceId],
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

// Lock-free pre-check for doPass: which (name, instance_id) pairs are
// provably idle — no locking, no xid, no WAL. A pair only qualifies when its
// row exists, its status isn't dead (dead must still go through
// acquireConsumerState for auto-rearm), it has no pending_gaps, and no event
// exists past its cursor. Paired via unnest so the two positional arrays
// zip element-wise into rows instead of a cartesian product.
//
// `deadStatus` is passed in rather than imported from event-consumer-state.ts
// (which defines ConsumerStatuses) — that module already imports from this
// one, so importing back would be a require cycle (same pattern as
// deleteOrphanedPerInstanceConsumerRows above).
export async function selectProvablyIdleConsumerPairs(
  db: AnyDb,
  names: readonly string[],
  instanceIds: readonly string[],
  deadStatus: string,
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
): Promise<void> {
  await asRawClient(db).unsafe(
    `UPDATE "kumiko_event_consumers" SET
       "last_processed_event_id" = $1,
       "status" = 'idle',
       "attempts" = 0,
       "last_error" = NULL,
       "updated_at" = now()
     WHERE "name" = $2 AND "instance_id" = $3`,
    [lastProcessedEventId, name, instanceId],
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
