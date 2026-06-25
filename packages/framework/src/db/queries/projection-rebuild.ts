import type { AnyDb } from "../query";
import { asRawClient } from "../query";

export async function markProjectionRebuilding(db: AnyDb, projectionName: string): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_projections" ("name", "status") VALUES ($1, 'rebuilding')
     ON CONFLICT ("name") DO UPDATE SET
       "status" = 'rebuilding',
       "last_error" = NULL,
       "updated_at" = now()`,
    [projectionName],
  );
}

// Cursor-paged read for the live-tail catch-up loop: one batch of events
// strictly newer than `afterId`, ascending. Each call is a fresh SELECT, so
// under READ COMMITTED it sees events committed by concurrent writers since the
// previous batch — that is what lets the rebuild drain the tail to ~0 lag.
export async function selectEventsForProjectionRebuildBatch(
  db: AnyDb,
  aggregateTypes: readonly string[],
  eventTypes: readonly string[],
  afterId: bigint,
  limit: number,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  return (await asRawClient(db).unsafe(
    `SELECT * FROM "kumiko_events"
     WHERE "aggregate_type" = ANY($1::text[])
       AND "type" = ANY($2::text[])
       AND "id" > $3
     ORDER BY "id" ASC
     LIMIT $4`,
    [aggregateTypes, eventTypes, afterId, limit],
  )) as ReadonlyArray<Record<string, unknown>>;
}

// Total subscribed events in the log — same source/type filter as
// selectEventsForProjectionRebuildBatch, no id cursor. Under the cutover fence
// this is the ground-truth count the rebuild must have applied; a shortfall
// means a lower-id event committed late and the id-cursor leapt past it (#443).
export async function countSubscribedEvents(
  db: AnyDb,
  aggregateTypes: readonly string[],
  eventTypes: readonly string[],
): Promise<bigint> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT count(*)::bigint AS n FROM "kumiko_events"
     WHERE "aggregate_type" = ANY($1::text[])
       AND "type" = ANY($2::text[])`,
    [aggregateTypes, eventTypes],
  )) as ReadonlyArray<{ n: bigint | string | number | null }>;
  const raw = rows[0]?.n;
  if (typeof raw === "bigint") return raw;
  if (raw === null || raw === undefined) return 0n;
  return BigInt(raw);
}

export async function finalizeProjectionRebuild(
  db: AnyDb,
  projectionName: string,
  lastProcessedEventId: bigint,
): Promise<void> {
  await asRawClient(db).unsafe(
    `UPDATE "kumiko_projections" SET
       "last_processed_event_id" = $1,
       "status" = 'idle',
       "last_rebuild_at" = now(),
       "last_error" = NULL,
       "updated_at" = now()
     WHERE "name" = $2`,
    [lastProcessedEventId, projectionName],
  );
}

export async function markProjectionRebuildFailed(
  db: AnyDb,
  projectionName: string,
  errorMessage: string,
): Promise<void> {
  await asRawClient(db).unsafe(
    `INSERT INTO "kumiko_projections" ("name", "status", "last_error") VALUES ($1, 'failed', $2)
     ON CONFLICT ("name") DO UPDATE SET
       "status" = 'failed',
       "last_error" = $2,
       "updated_at" = now()`,
    [projectionName, errorMessage],
  );
}
