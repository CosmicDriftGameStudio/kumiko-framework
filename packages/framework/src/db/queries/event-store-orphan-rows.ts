import type { TenantId } from "../../engine/types/index.ts";
import { type AnyDb, asRawClient } from "../query.ts";
import { tableNameOf } from "../table-introspection.ts";
import { isBoundTenantDb, tenantDbWriteRunner } from "../tenant-db-runner.ts";
import { toPostgresArrayLiteral } from "./postgres-array-literal.ts";
import { quoteTableIdent } from "./table-ops.ts";

export type DeleteRowsWithoutReplayableStreamArgs = {
  readonly table: unknown;
  readonly ids: readonly string[];
  // Raw runners only; a TenantDb always pins its own tenant.
  readonly tenantId?: TenantId;
};

// Deletes only rows a projection rebuild would not recreate: the row's stream has no events, or is archived.
// One statement, so a stream cannot gain events between check and delete.
export async function deleteRowsWithoutReplayableStream(
  db: AnyDb,
  args: DeleteRowsWithoutReplayableStreamArgs,
): Promise<readonly string[]> {
  if (args.ids.length === 0) return [];
  const tenantBound = isBoundTenantDb(db);
  const tenantId = tenantBound ? db.tenantId : args.tenantId;
  const runner = tenantBound ? tenantDbWriteRunner(db, "deleteRowsWithoutReplayableStream") : db;
  const params: unknown[] = [toPostgresArrayLiteral(args.ids)];
  let tenantFilter = "";
  if (tenantId !== undefined) {
    params.push(tenantId);
    tenantFilter = `AND t."tenant_id" = $2`;
  }
  const rows = await asRawClient(runner).unsafe<{ id: string }>(
    `DELETE FROM ${quoteTableIdent(tableNameOf(args.table))} t
     WHERE t."id" = ANY($1::uuid[]) ${tenantFilter}
       AND NOT EXISTS (
         SELECT 1 FROM "kumiko_events" e
          WHERE e."tenant_id" = t."tenant_id" AND e."aggregate_id" = t."id"
            AND NOT EXISTS (
              SELECT 1 FROM "kumiko_archived_streams" a
               WHERE a."tenant_id" = e."tenant_id" AND a."aggregate_id" = e."aggregate_id"
            )
       )
     RETURNING t."id"`,
    params,
  );
  return rows.map((row) => row.id);
}
