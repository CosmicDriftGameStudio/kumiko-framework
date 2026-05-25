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

export async function selectEventsForProjectionRebuild(
  db: AnyDb,
  aggregateTypes: readonly string[],
  eventTypes: readonly string[],
): Promise<ReadonlyArray<Record<string, unknown>>> {
  return (await asRawClient(db).unsafe(
    `SELECT * FROM "kumiko_events"
     WHERE "aggregate_type" = ANY($1::text[])
       AND "type" = ANY($2::text[])
     ORDER BY "id" ASC`,
    [aggregateTypes, eventTypes],
  )) as ReadonlyArray<Record<string, unknown>>;
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
