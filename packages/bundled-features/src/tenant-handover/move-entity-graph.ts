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
import { resolveTransferGraph } from "./transfer-graph";

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
  // skip: an empty id list has nothing to move — both callers already
  // filter to a non-empty list before calling, this only guards a future
  // caller that forgets to.
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

// `idCol` is a `parentRef.entityIdField` — by convention a text column (see
// tags' tag-assignment entity: "Host entity ids are uuid/text; 128 covers
// uuid plus non-uuid text keys"), never enforced as a type. A future
// uuid-typed entityIdField would need the same CASE-guarded comparison
// parent-ref-clause.ts uses for reads, to avoid a 22P02 on a non-uuid value
// instead of silently matching zero rows.
async function moveChildRows(args: {
  readonly db: DbRunner;
  readonly tableName: string;
  readonly typeCol: string;
  readonly idCol: string;
  readonly tenantCol: string;
  readonly pkCol: string;
  readonly parentEntityType: string;
  readonly parentRowIds: readonly string[];
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
}): Promise<readonly string[]> {
  const rows = await executeRawQuery<{ id: string }>(
    args.db,
    `UPDATE "${args.tableName}" SET "${args.tenantCol}" = $1 ` +
      `WHERE "${args.typeCol}" = $2 AND "${args.idCol}" = ANY($3) AND "${args.tenantCol}" = $4 ` +
      `RETURNING "${args.pkCol}" AS id`,
    [args.destinationTenantId, args.parentEntityType, args.parentRowIds, args.sourceTenantId],
  );
  return rows.map((row) => row.id);
}

// A `reference` field names its target entity in the schema, so unlike a
// parentRef there is no type discriminator column to match on — the column
// itself only ever holds ids of that one entity.
async function moveReferencedChildRows(args: {
  readonly db: DbRunner;
  readonly tableName: string;
  readonly refCol: string;
  readonly tenantCol: string;
  readonly pkCol: string;
  readonly parentRowIds: readonly string[];
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
}): Promise<readonly string[]> {
  const rows = await executeRawQuery<{ id: string }>(
    args.db,
    `UPDATE "${args.tableName}" SET "${args.tenantCol}" = $1 ` +
      `WHERE "${args.refCol}" = ANY($2) AND "${args.tenantCol}" = $3 ` +
      `RETURNING "${args.pkCol}" AS id`,
    [args.destinationTenantId, args.parentRowIds, args.sourceTenantId],
  );
  return rows.map((row) => row.id);
}

// Everything the root ownership write does NOT cover: the root's own event
// history + attached files, plus the rows, event history and attached files of
// every descendant the declared transfer graph reaches — level by level, so a
// nested reference chain moves whole rather than one level deep (#3088).
// Returns a count per moved entity name (the
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
    // skip: nothing moved (this entity had no attached files) — the audit
    // payload should list `fileRef` only when a file actually moved, not a
    // stray zero entry for every root/child that happens to have none.
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

  // Row ids per entity type, fed forward: level N's edges match against the
  // ids level N-1 actually moved. A row already moved by an earlier edge no
  // longer matches `tenantCol = source`, so a second edge reaching it returns
  // nothing — the move is idempotent without a separate visited set.
  const movedIdsByEntity = new Map<string, readonly string[]>([[rootEntityName, [rootRowId]]]);
  const { levels, overflowEdges } = resolveTransferGraph(registry, rootEntityName);

  for (const level of levels) {
    const freshIdsByEntity = new Map<string, string[]>();

    for (const edge of level) {
      const parentRowIds = movedIdsByEntity.get(edge.parentEntityName) ?? [];
      // skip: the previous level moved no rows of this parent type, so this
      // edge has nothing to hang off.
      if (parentRowIds.length === 0) continue;

      const table = entityTableFromRegistry(registry, edge.entityName, edge.entity);
      const tableName = extractTableName(table);
      const tenantCol = physicalColumnName(table, "tenantId");
      const pkCol = physicalColumnName(table, "id");

      const childIds =
        edge.link.kind === "parentRef"
          ? await moveChildRows({
              db,
              tableName,
              typeCol: physicalColumnName(table, edge.link.typeField),
              idCol: physicalColumnName(table, edge.link.idField),
              tenantCol,
              pkCol,
              parentEntityType: edge.parentEntityName,
              parentRowIds,
              sourceTenantId,
              destinationTenantId,
            })
          : await moveReferencedChildRows({
              db,
              tableName,
              refCol: physicalColumnName(table, edge.link.field),
              tenantCol,
              pkCol,
              parentRowIds,
              sourceTenantId,
              destinationTenantId,
            });
      if (childIds.length === 0) continue;

      // Moved first, validated second — safe only because everything here
      // shares the root UPDATE's transaction (see file header): throwing now
      // rolls this move back together with the root's, not just this one.
      if (edge.entity.transferable !== true) {
        throw new UnprocessableError("entity_not_transferable", {
          i18nKey: "errors.tenantHandover.entityNotTransferable",
          details: { entityName: edge.entityName },
        });
      }

      // `+=`, not `=`: one entity type can be reached by more than one edge
      // (`note.vehicleId` and `note.campaignId`), and assigning would drop the
      // earlier count.
      movedCounts[edge.entityName] = (movedCounts[edge.entityName] ?? 0) + childIds.length;
      const fresh = freshIdsByEntity.get(edge.entityName) ?? [];
      fresh.push(...childIds);
      freshIdsByEntity.set(edge.entityName, fresh);

      await moveEventHistory({
        db,
        aggregateType: edge.entityName,
        aggregateIds: childIds,
        sourceTenantId,
        destinationTenantId,
      });
      trackFileMove(
        await moveFileRefs({
          db,
          entityType: edge.entityName,
          entityIds: childIds,
          sourceTenantId,
          destinationTenantId,
        }),
      );
    }

    for (const [entityName, ids] of freshIdsByEntity) {
      movedIdsByEntity.set(entityName, ids);
    }
  }

  // The depth limit is a safety net, not a licence to move part of a graph:
  // if the level that got truncated actually hangs off rows this handover
  // moved, the declaration reaches further than the mover does, and stopping
  // quietly would leave exactly the orphaned rows #3088 is about. The boot
  // validator catches the common shape of this up front, but it measures
  // reference chains between transferable entities only — this is what closes
  // the remaining gap, and it rolls the whole transaction back.
  //
  // The id lookup is the last level that moved rows of that type, not
  // necessarily the level the overflow edge hangs off, so this can fire on a
  // graph whose deepest rows are older than the truncation. It only reaches
  // here for a declaration already past the limit, where erring towards the
  // named error beats moving part of a graph.
  const strandedEdge = overflowEdges.find(
    (edge) => (movedIdsByEntity.get(edge.parentEntityName) ?? []).length > 0,
  );
  if (strandedEdge !== undefined) {
    throw new UnprocessableError("transfer_graph_too_deep", {
      i18nKey: "errors.tenantHandover.transferGraphTooDeep",
      details: {
        entityName: strandedEdge.entityName,
        parentEntityName: strandedEdge.parentEntityName,
      },
    });
  }

  return movedCounts;
}
