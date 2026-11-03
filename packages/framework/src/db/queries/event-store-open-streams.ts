import type { DbRunner } from "../connection.ts";
import { asRawClient } from "../query.ts";
import { toPostgresArrayLiteral } from "./postgres-array-literal.ts";

export type OpenStreamsArgs = {
  readonly aggregateType: string;
  // The event that opens a stream; only streams whose opening event is older than startedBeforeIso qualify.
  readonly startedType: string;
  // A stream holding any of these is closed.
  readonly closingTypes: readonly string[];
  readonly startedBeforeIso: string;
  readonly limit: number;
};

export type OpenStream = {
  readonly tenantId: string;
  readonly aggregateId: string;
};

// Cross-tenant on a raw runner: system sweepers find streams that never got their closing event.
// Archived streams are skipped, since nothing can be appended to them anymore.
export async function selectOpenStreamsStartedBefore(
  db: DbRunner,
  args: OpenStreamsArgs,
): Promise<readonly OpenStream[]> {
  const rows = await asRawClient(db).unsafe<{ tenant_id: string; aggregate_id: string }>(
    `SELECT s."tenant_id", s."aggregate_id"
       FROM "kumiko_events" s
      WHERE s."aggregate_type" = $1 AND s."type" = $2 AND s."created_at" < $3::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM "kumiko_events" c
           WHERE c."tenant_id" = s."tenant_id" AND c."aggregate_id" = s."aggregate_id"
             AND c."type" = ANY($4::text[])
        )
        AND NOT EXISTS (
          SELECT 1 FROM "kumiko_archived_streams" a
           WHERE a."tenant_id" = s."tenant_id" AND a."aggregate_id" = s."aggregate_id"
        )
      ORDER BY s."id" ASC
      LIMIT $5`,
    [
      args.aggregateType,
      args.startedType,
      args.startedBeforeIso,
      toPostgresArrayLiteral([...args.closingTypes]),
      args.limit,
    ],
  );
  return rows.map((row) => ({ tenantId: row.tenant_id, aggregateId: row.aggregate_id }));
}
