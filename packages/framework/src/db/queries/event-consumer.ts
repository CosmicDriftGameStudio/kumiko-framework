import type { AnyDb } from "../query";
import { asRawClient } from "../query";

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
       "updated_at" = now()
     WHERE "name" = $6 AND "instance_id" = $7`,
    [
      outcome.cursor,
      outcome.attempts,
      outcome.deadLettered ? "dead" : "idle",
      outcome.lastError,
      resetRearmCount,
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
    `INSERT INTO "kumiko_event_consumers" ("name", "instance_id", "last_processed_event_id", "status")
     VALUES ($1, $2, 0, 'idle')
     ON CONFLICT ("name", "instance_id") DO UPDATE SET
       "last_processed_event_id" = 0,
       "status" = 'idle',
       "attempts" = 0,
       "last_error" = NULL,
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
