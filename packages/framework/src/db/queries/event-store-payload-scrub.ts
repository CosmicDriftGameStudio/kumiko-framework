import type { DbRunner } from "../connection.ts";
import { asRawClient } from "../query.ts";
import { toPostgresArrayLiteral } from "./postgres-array-literal.ts";

export type ScrubEventRow = {
  readonly id: bigint | string;
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly tenant_id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
};

export function selectEventsOfTypeAfter(
  db: DbRunner,
  eventType: string,
  afterEventId: string,
  limit: number,
): Promise<readonly ScrubEventRow[]> {
  return asRawClient(db).unsafe<ScrubEventRow>(
    `SELECT "id", "aggregate_id", "aggregate_type", "tenant_id", "type", "payload"
       FROM "kumiko_events"
      WHERE "type" = $1 AND "id" > $2::bigint
      ORDER BY "id" ASC
      LIMIT $3`,
    [eventType, afterEventId, limit],
  );
}

export async function replaceEventPayload(
  db: DbRunner,
  eventId: bigint | string,
  payload: Record<string, unknown>,
): Promise<void> {
  await asRawClient(db).unsafe(`UPDATE "kumiko_events" SET "payload" = $1::jsonb WHERE "id" = $2`, [
    payload,
    eventId,
  ]);
}

// Snapshots may cache the replaced values of the streams; the next snapshotting load recreates them.
export async function deleteSnapshotsOfAggregates(
  db: DbRunner,
  aggregateIds: readonly string[],
): Promise<number> {
  const deleted = await asRawClient(db).unsafe(
    `DELETE FROM "kumiko_snapshots" WHERE "aggregate_id" = ANY($1::uuid[]) RETURNING "aggregate_id"`,
    [toPostgresArrayLiteral([...aggregateIds])],
  );
  return deleted.length;
}
