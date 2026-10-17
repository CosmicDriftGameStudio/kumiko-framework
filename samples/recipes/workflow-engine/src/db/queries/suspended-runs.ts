import {
  asRawClient,
  type DbRunner,
  toPostgresArrayLiteral,
} from "@cosmicdrift/kumiko-framework/db";

export async function selectExpiredSuspensionEvents(
  db: DbRunner,
  eventTypes: readonly string[],
): Promise<readonly Record<string, unknown>[]> {
  return (await asRawClient(db).unsafe(
    `SELECT * FROM "kumiko_events"
       WHERE "type" = ANY($1::text[])
       AND (("payload"->>'wakeAt')::timestamptz < now() OR ("payload"->>'timeoutAt')::timestamptz < now())`,
    [toPostgresArrayLiteral(eventTypes)],
  )) as Record<string, unknown>[];
}
