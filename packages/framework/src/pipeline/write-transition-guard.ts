import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import type { DbRow, DbTx } from "../db/connection.ts";
import { selectRowForUpdateById } from "../db/queries/entity-read.ts";
import { asEntityTableMeta, selectMany } from "../db/query.ts";
import { toSnakeCase } from "../db/table-builder.ts";
import { tenantDbRunner } from "../db/tenant-db-runner.ts";
import { defineTransitions, guardTransition } from "../engine/state-machine.ts";
import type { HandlerContext } from "../engine/types/index.ts";
import { getTable } from "./dispatch-context-helpers.ts";
import type { DispatchContext } from "./dispatch-shared.ts";

function getTransitions(
  ctx: DispatchContext,
  args: {
    entityName: string;
    fieldName: string;
    map: Record<string, readonly string[]>;
  },
): ReturnType<typeof defineTransitions> {
  const { transitionCache } = ctx;
  // Scope by entity — `fieldName` alone collides across entities (e.g. both
  // `invoice.status` and `driverOrder.status` exist with different maps),
  // which would apply the wrong transition rules to whichever entity arrives
  // second.
  const key = `${args.entityName}:${args.fieldName}`;
  const cached = transitionCache.get(key);
  if (cached) return cached;
  const transitions = defineTransitions(args.map);
  transitionCache.set(key, transitions);
  return transitions;
}

// Reads via the guard's own db handle — for r.systemScope() handlers
// handlerContext.db is fail-closed, so this reaches for
// systemDb.acknowledgeCrossTenant like any other framework-internal
// mechanism that touches a system-scoped handler's data.
export function resolveTransitionGuardDb(handlerContext: HandlerContext, type: string) {
  return handlerContext.systemDb
    ? handlerContext.systemDb.acknowledgeCrossTenant(
        `auto transition guard for r.systemScope() write handler (${type})`,
      )
    : handlerContext.db;
}

export type TransitionGuardDb = ReturnType<typeof resolveTransitionGuardDb>;

// Auto transition guard: if entity has transitions and handler doesn't skip it.
export async function guardAutoTransitions(
  ctx: DispatchContext,
  handler: WriteHandlerDef,
  type: string,
  parsedPayload: unknown,
  transitionGuardDb: TransitionGuardDb,
  tx: DbTx | undefined,
): Promise<void> {
  const entityName = ctx.registry.getHandlerEntity(type);
  // skip: handler has no entity or opted out of the transition guard
  if (!entityName || handler.unsafeSkipTransitionGuard) return;
  const entity = ctx.registry.getEntity(entityName);
  // skip: entity declares no transitions, or there is no db to read the current value from
  if (!entity?.transitions || !transitionGuardDb) return;
  const parsedData = parsedPayload as DbRow; // @cast-boundary engine-payload
  const changes = (parsedData["changes"] as DbRow) ?? parsedData; // @cast-boundary engine-payload
  const id = (parsedData["id"] as number) ?? undefined; // @cast-boundary engine-payload

  for (const [fieldName, transitionMap] of Object.entries(entity.transitions)) {
    await guardFieldTransition(ctx, {
      entityName,
      entity,
      fieldName,
      transitionMap,
      changes,
      id,
      transitionGuardDb,
      tx,
    });
  }
}

async function guardFieldTransition(
  ctx: DispatchContext,
  args: {
    readonly entityName: string;
    readonly entity: EntityDefinition;
    readonly fieldName: string;
    readonly transitionMap: Record<string, readonly string[]>;
    readonly changes: DbRow;
    readonly id: number | undefined;
    readonly transitionGuardDb: NonNullable<TransitionGuardDb>;
    readonly tx: DbTx | undefined;
  },
): Promise<void> {
  const { entityName, entity, fieldName, transitionMap, changes, id, transitionGuardDb, tx } = args;
  const newValue = changes[fieldName] as string | undefined; // @cast-boundary engine-bridge
  // skip: field is not part of this write
  if (!newValue || !id) return;

  const table = getTable(ctx, entityName);
  // skip: entity has no table to read the current value from
  if (!table) return;

  // SELECT FOR UPDATE inside the surrounding transaction — locks the
  // row so a concurrent handler can't mutate `status` between our
  // guard check and the handler's UPDATE. Without this lock the guard
  // can false-pass; optimistic locking would catch it later, but with
  // a less specific error. Falls back to a plain SELECT if no tx is
  // active (tests without a DB connection).
  const tableName = asEntityTableMeta(table)?.tableName ?? "";
  const rows = tx
    ? await selectRowForUpdateById(tenantDbRunner(transitionGuardDb), tableName, id)
    : await selectMany(transitionGuardDb, table, { id });
  const row = rows[0];

  // skip: no stored row to transition from
  if (!row) return;
  // Skip guard for soft-deleted rows — they shouldn't be transitioning
  // at all; a handler that wants to move a deleted row should use
  // unsafeSkipTransitionGuard or restore first.
  const rowAsRow = row as DbRow; // @cast-boundary engine-payload
  const isDeleted = rowAsRow["isDeleted"] ?? rowAsRow["is_deleted"];
  // skip: soft-deleted row
  if (entity.softDelete && isDeleted === true) {
    return;
  }
  const currentValue =
    ((row as DbRow)[fieldName] as string | undefined) ??
    ((row as DbRow)[toSnakeCase(fieldName)] as string); // @cast-boundary engine-bridge
  // skip: an unchanged value is no transition (an edit form resends the current status)
  if (currentValue === newValue) return;
  guardTransition(
    getTransitions(ctx, { entityName, fieldName, map: transitionMap }),
    currentValue,
    newValue,
  );
}
