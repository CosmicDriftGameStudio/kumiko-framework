import { buildOwnershipClause, combineClauses, type OwnershipClause } from "../engine/ownership.ts";
import type { SessionUser } from "../engine/types/index.ts";
import type { ExecutorContext } from "./event-store-executor-context.ts";
import { buildParentRefClause, type ParentVisibilityOption } from "./parent-ref-clause.ts";
import { buildReadGateClause } from "./read-gate-clause.ts";
import type { TenantDb } from "./tenant-db.ts";

// H.2 — entity-level read ownership, AND-ed with the parent-ref read-gate
// (join-row entities derive their visibility from a host row's own read path —
// see db/parent-ref-clause.ts) and the declarative readGate (db/read-gate-clause.ts). `empty` means there's no row the user could ever see.
// Lives apart from the list WHERE builder so the reference search and sort can gate their
// target rows the same way without an import cycle.
export function resolveReadOwnership(
  ctx: Pick<ExecutorContext, "entity" | "table">,
  tableName: string,
  user: SessionUser,
  db: TenantDb,
  parentVisibility: ParentVisibilityOption | undefined,
  gate: { readonly includeDeleted: boolean; readonly narrowTypes: ReadonlySet<string> | undefined },
): OwnershipClause {
  const parentClause = buildParentRefClause(
    ctx.entity,
    ctx.table,
    tableName,
    user,
    db,
    parentVisibility,
    gate,
  );
  return combineClauses(
    combineClauses(
      buildOwnershipClause(user, ctx.entity.access?.read, ctx.table, 1, tableName),
      parentClause,
    ),
    buildReadGateClause(ctx.entity, ctx.table, tableName, user, db, parentVisibility),
  );
}
