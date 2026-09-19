// The actual ownership change (kumiko-framework#3035): raw SQL against the
// event store + read-model tables, because moving a row across the tenant
// boundary is exactly the kind of write the framework's entity write map
// cannot express (it is single-tenant-scoped by design — that boundary is
// the whole point of `assertTenantMatch`). This is the framework's OWN
// declared operation, not a consumer's `acknowledgeCrossTenant` escape.
//
// Every statement here runs inside the calling write handler's own
// transaction (HandlerContext.db is transaction-scoped for the handler's
// full duration — confirmed by dispatch-batch.ts's runBatch: a write handler
// returning writeFailure throws BatchRollback inside the wrapping
// `transaction()` call, rolling back everything the handler already did).
// `moveRootRow` — called as row-bound-grant's `commitAnchor` — is therefore
// the ONLY statement that must itself combine the anchor-spend with the
// first write (#3023's hard rule: a write issued after `ok: true` can lose
// its work to a crash while the grant is already burned). Everything after
// it rides the same transaction: if a later step throws (an undeclared
// child entity, kumiko-framework#3035's named-error requirement), the WHOLE
// transaction — root row included — rolls back, so a caller can safely
// retry the same token after fixing the app's `transferable` declarations.

import {
  type DbRunner,
  entityTableFromRegistry,
  executeRawQuery,
  extractTableName,
  physicalColumnName,
} from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { resolveChildCandidates } from "./transfer-graph";

const FILE_REFS_TABLE = "file_refs";
const EVENTS_TABLE = "kumiko_events";
const SNAPSHOTS_TABLE = "kumiko_snapshots";

// The commitAnchor statement itself: spends the anchor (WHERE tenant_id =
// expected) AND performs the ownership write (SET tenant_id = destination)
// in one UPDATE — see file header. Returns whether THIS caller won.
export async function moveRootRow(args: {
  readonly db: DbRunner;
  readonly tableName: string;
  readonly idCol: string;
  readonly tenantCol: string;
  readonly rowId: string;
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
}): Promise<boolean> {
  const rows = await executeRawQuery<{ id: string }>(
    args.db,
    `UPDATE "${args.tableName}" SET "${args.tenantCol}" = $2 ` +
      `WHERE "${args.idCol}" = $1 AND "${args.tenantCol}" = $3 ` +
      `RETURNING "${args.idCol}" AS id`,
    [args.rowId, args.destinationTenantId, args.sourceTenantId],
  );
  return rows.length === 1;
}

async function moveEventHistory(args: {
  readonly db: DbRunner;
  readonly aggregateType: string;
  readonly aggregateIds: readonly string[];
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
}): Promise<void> {
  if (args.aggregateIds.length === 0) return;
  await executeRawQuery(
    args.db,
    `UPDATE ${EVENTS_TABLE} SET tenant_id = $1 ` +
      `WHERE tenant_id = $2 AND aggregate_type = $3 AND aggregate_id = ANY($4)`,
    [args.destinationTenantId, args.sourceTenantId, args.aggregateType, args.aggregateIds],
  );
  // Snapshots are a pure read-performance cache (event-store/snapshot.ts) —
  // dropped rather than rewritten, forcing a full replay from the just-moved
  // events on next read instead of carrying the snapshot's own generation
  // bookkeeping across the tenant boundary.
  await executeRawQuery(
    args.db,
    `DELETE FROM ${SNAPSHOTS_TABLE} WHERE tenant_id = $1 AND aggregate_id = ANY($2)`,
    [args.sourceTenantId, args.aggregateIds],
  );
}

async function moveFileRefs(args: {
  readonly db: DbRunner;
  readonly entityType: string;
  readonly entityIds: readonly string[];
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
}): Promise<number> {
  if (args.entityIds.length === 0) return 0;
  const rows = await executeRawQuery<{ id: string }>(
    args.db,
    `UPDATE ${FILE_REFS_TABLE} SET tenant_id = $1 ` +
      `WHERE tenant_id = $2 AND entity_type = $3 AND entity_id = ANY($4) RETURNING id`,
    [args.destinationTenantId, args.sourceTenantId, args.entityType, args.entityIds],
  );
  return rows.length;
}

async function moveChildRows(args: {
  readonly db: DbRunner;
  readonly tableName: string;
  readonly typeCol: string;
  readonly idCol: string;
  readonly tenantCol: string;
  readonly pkCol: string;
  readonly rootEntityType: string;
  readonly rootRowId: string;
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
}): Promise<readonly string[]> {
  const rows = await executeRawQuery<{ id: string }>(
    args.db,
    `UPDATE "${args.tableName}" SET "${args.tenantCol}" = $1 ` +
      `WHERE "${args.typeCol}" = $2 AND "${args.idCol}" = $3 AND "${args.tenantCol}" = $4 ` +
      `RETURNING "${args.pkCol}" AS id`,
    [args.destinationTenantId, args.rootEntityType, args.rootRowId, args.sourceTenantId],
  );
  return rows.map((row) => row.id);
}

// Everything the root ownership write does NOT cover: the root's own event
// history + attached files, plus every parentRef-linked child's rows, event
// history, and attached files. Returns a count per moved entity name (the
// write handler turns this into the audit entry) — `fileRef` is a single
// pooled count across root + every child, since it is not itself part of the
// declared transfer graph (see files-tenant-data's own handover coverage for
// why file BYTES never move, only the fileRef row's ownership).
export async function moveTransferGraph(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly rootEntityName: string;
  readonly rootRowId: string;
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
}): Promise<Readonly<Record<string, number>>> {
  const { db, registry, rootEntityName, rootRowId, sourceTenantId, destinationTenantId } = args;
  const movedCounts: Record<string, number> = { [rootEntityName]: 1 };
  const trackFileMove = (count: number) => {
    if (count === 0) return;
    movedCounts["fileRef"] = (movedCounts["fileRef"] ?? 0) + count;
  };

  await moveEventHistory({
    db,
    aggregateType: rootEntityName,
    aggregateIds: [rootRowId],
    sourceTenantId,
    destinationTenantId,
  });
  trackFileMove(
    await moveFileRefs({
      db,
      entityType: rootEntityName,
      entityIds: [rootRowId],
      sourceTenantId,
      destinationTenantId,
    }),
  );

  for (const candidate of resolveChildCandidates(registry, rootEntityName)) {
    const parentRef = candidate.entity.parentRef;
    if (!parentRef) continue; // resolveChildCandidates already filtered on this — narrows for TS
    const table = entityTableFromRegistry(registry, candidate.entityName, candidate.entity);
    const tableName = extractTableName(table);
    const typeCol = physicalColumnName(table, parentRef.entityTypeField);
    const idCol = physicalColumnName(table, parentRef.entityIdField);
    const tenantCol = physicalColumnName(table, "tenantId");
    const pkCol = physicalColumnName(table, "id");

    const childIds = await moveChildRows({
      db,
      tableName,
      typeCol,
      idCol,
      tenantCol,
      pkCol,
      rootEntityType: rootEntityName,
      rootRowId,
      sourceTenantId,
      destinationTenantId,
    });
    if (childIds.length === 0) continue;

    // Moved first, validated second — safe only because everything here
    // shares the root UPDATE's transaction (see file header): throwing now
    // rolls this move back together with the root's, not just this one.
    if (candidate.entity.transferable !== true) {
      throw new UnprocessableError("entity_not_transferable", {
        i18nKey: "errors.tenantHandover.entityNotTransferable",
        details: { entityName: candidate.entityName },
      });
    }

    movedCounts[candidate.entityName] = childIds.length;
    await moveEventHistory({
      db,
      aggregateType: candidate.entityName,
      aggregateIds: childIds,
      sourceTenantId,
      destinationTenantId,
    });
    trackFileMove(
      await moveFileRefs({
        db,
        entityType: candidate.entityName,
        entityIds: childIds,
        sourceTenantId,
        destinationTenantId,
      }),
    );
  }

  return movedCounts;
}
