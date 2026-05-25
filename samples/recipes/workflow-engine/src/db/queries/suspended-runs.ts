import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

export async function selectExpiredSuspensionEvents(
  db: DbRunner,
  eventTypes: readonly string[],
): Promise<readonly Record<string, unknown>[]> {
  return (await asRawClient(db).unsafe(
    `SELECT * FROM "kumiko_events"
       WHERE "type" = ANY($1::text[])
       AND (("payload"->>'wakeAt')::timestamptz < now() OR ("payload"->>'timeoutAt')::timestamptz < now())`,
    [eventTypes as unknown as string[]],
  )) as Record<string, unknown>[];
}
