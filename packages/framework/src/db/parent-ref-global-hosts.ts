import type { ParentVisibilityOption } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import type { SessionUser } from "../engine/types/index.ts";
import type { Table } from "./event-store-executor-context.ts";
import { buildParentRefGate, readsGlobalHostsUnderTenantScope } from "./parent-ref-clause.ts";
import { executeRawQueryRead } from "./queries/raw-sql.ts";
import { systemScopedRunner } from "./row-level-security-scope.ts";
import { physicalColumnName } from "./table-builder.ts";
import { schemaTableName } from "./table-introspection.ts";
import type { TenantDb } from "./tenant-db.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";

type HostRow = { readonly entityType: string; readonly entityId: string };

// Narrows the resolution to the join rows the gated statement can match: the one row of a
// detail or row check, or the host ids a list filter pins. Narrowing never widens the result,
// because the gated statement applies the same row id or filter itself.
export type GlobalHostRowScope =
  | { readonly kind: "row"; readonly rowId: EntityId }
  | { readonly kind: "list"; readonly pinnedHostIds: ReadonlySet<string> | undefined };

// The gated statement runs under the tenant scope, where a global host's EXISTS sees no row. The
// same host check runs here in the system scope, limited to the caller's join rows by an explicit
// tenant filter, and only host ids leave it; the gated statement keeps its own row level security.
export async function withGlobalParentHosts(
  ctx: { readonly entity: EntityDefinition; readonly table: Table },
  user: SessionUser,
  db: TenantDb,
  option: ParentVisibilityOption | undefined,
  gate: { readonly includeDeleted: boolean; readonly narrowTypes: ReadonlySet<string> | undefined },
  rowScope: GlobalHostRowScope,
): Promise<ParentVisibilityOption | undefined> {
  const { entity, table } = ctx;
  const parentRef = entity.parentRef;
  if (option === undefined || parentRef === undefined || db.mode !== "tenant") return option;
  if (!readsGlobalHostsUnderTenantScope(db, table) || table["tenantId"] === undefined) {
    return option;
  }

  const joinTableName = String(schemaTableName(table));
  const hostCheck = buildParentRefGate(
    entity,
    table,
    joinTableName,
    user,
    db,
    option,
    gate,
    "globalHostsOnly",
  );
  if (hostCheck.kind !== "sql") return option;

  if (rowScope.kind === "list" && rowScope.pinnedHostIds?.size === 0) {
    return { ...option, globalHostIds: new Map() };
  }

  const params: unknown[] = [...hostCheck.params, db.tenantId];
  const column = (field: string) => `"${joinTableName}"."${physicalColumnName(table, field)}"`;
  const whereParts = [`${column("tenantId")} = $${params.length}`, hostCheck.sqlText];
  if (rowScope.kind === "row") {
    params.push(rowScope.rowId);
    whereParts.push(`${column("id")} = $${params.length}`);
  } else if (rowScope.pinnedHostIds !== undefined) {
    params.push([...rowScope.pinnedHostIds]);
    whereParts.push(`${column(parentRef.entityIdField)}::text = ANY($${params.length}::text[])`);
  }
  const rows = await executeRawQueryRead<HostRow>(
    systemScopedRunner(
      tenantDbRunner(db),
      "parent-ref gate checks global hosts, whose rows carry the system tenant, for the caller's own join rows",
    ),
    `SELECT DISTINCT ${column(parentRef.entityTypeField)}::text AS "entityType", ${column(parentRef.entityIdField)}::text AS "entityId" ` +
      `FROM "${joinTableName}" WHERE ${whereParts.join(" AND ")}`,
    params,
  );

  const globalHostIds = new Map<string, string[]>();
  for (const row of rows) {
    const ids = globalHostIds.get(row.entityType);
    if (ids === undefined) globalHostIds.set(row.entityType, [row.entityId]);
    else ids.push(row.entityId);
  }
  return { ...option, globalHostIds };
}
