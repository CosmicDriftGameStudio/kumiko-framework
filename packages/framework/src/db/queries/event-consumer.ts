import type { AnyDb } from "../query";
import { asRawClient } from "../query";

/** Serialise against consumer-bootstrap INSERTs during event retention prune. */
export async function lockEventConsumersShareMode(db: AnyDb): Promise<void> {
  await asRawClient(db).unsafe(`LOCK TABLE "kumiko_event_consumers" IN SHARE MODE`);
}

export async function insertConsumerIfAbsent(
  db: AnyDb,
  name: string,
  instanceId: string,
): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_event_consumers" ("name", "instance_id", "status") VALUES ($1, $2, 'idle')
     ON CONFLICT ("name", "instance_id") DO NOTHING`,
    [name, instanceId],
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
