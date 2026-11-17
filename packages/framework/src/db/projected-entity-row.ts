import type { ExecutorManagedRunner } from "@cosmicdrift/kumiko-types/executor-brand";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { InternalError } from "../errors/index.ts";
import type { StoredEvent } from "../event-store/index.ts";
import type { EntityTableMeta } from "./entity-table-meta.ts";
import { insertOne, updateMany } from "./query.ts";
import type { EntityRow } from "./table-builder.ts";
import { extractTableInfo } from "./table-info.ts";

const PROJECTED_ROW_META_KEYS = [
  "id",
  "tenantId",
  "version",
  "insertedAt",
  "insertedById",
  "modifiedAt",
  "modifiedById",
] as const;
type ProjectedRowMetaKey = (typeof PROJECTED_ROW_META_KEYS)[number];

export type ProjectedEntityTarget<E extends EntityDefinition> = {
  readonly entityName: string;
  readonly entity: E;
  readonly table: EntityTableMeta;
};

export type ProjectedEntityValues<E extends EntityDefinition> = Partial<
  Omit<EntityRow<E>, ProjectedRowMetaKey>
>;

function isRowMetaKey(key: string): boolean {
  return PROJECTED_ROW_META_KEYS.some((metaKey) => metaKey === key);
}

// Payload spreads are Record<string, unknown>, so the type cannot catch a stray key,
// and insertOne would drop an unknown key silently.
function assertFieldColumns(
  target: ProjectedEntityTarget<EntityDefinition>,
  values: Record<string, unknown>,
  caller: string,
): void {
  const info = extractTableInfo(target.table);
  for (const key of Object.keys(values)) {
    if (isRowMetaKey(key) || !info.hasColumn(key)) {
      throw new InternalError({
        message: `${caller}: "${key}" is not a field column of ${target.entityName}; the helper sets the row metadata itself`,
      });
    }
  }
}

// A row from another stream survives a rebuild only when rowId is the rowIdOf an r.extendEntityProjection declares for that source.
export async function insertProjectedEntityRow<E extends EntityDefinition>(
  tx: ExecutorManagedRunner,
  target: ProjectedEntityTarget<E>,
  event: StoredEvent,
  rowId: string,
  values: ProjectedEntityValues<E>,
): Promise<void> {
  assertFieldColumns(target, values, "insertProjectedEntityRow");
  // A row created by an event on its own stream starts at that event's version (the stream
  // bump ran before this apply and found no row); a row created from another stream has no
  // stream of its own.
  const version =
    event.aggregateType === target.entityName && event.aggregateId === rowId ? event.version : 1;
  await insertOne(tx, target.table, {
    ...values,
    id: rowId,
    tenantId: event.tenantId,
    version,
    insertedAt: event.createdAt,
    insertedById: event.createdBy,
  });
}

export async function patchProjectedEntityRow<E extends EntityDefinition>(
  tx: ExecutorManagedRunner,
  target: ProjectedEntityTarget<E>,
  event: StoredEvent,
  rowId: string,
  set: ProjectedEntityValues<E>,
): Promise<void> {
  assertFieldColumns(target, set, "patchProjectedEntityRow");
  // No version: an event on the row's own stream already moved it (runProjectionsForEvent,
  // rebuild alignment); an event from another stream must not stamp its stream's version on this row.
  await updateMany(
    tx,
    target.table,
    { ...set, modifiedAt: event.createdAt, modifiedById: event.createdBy },
    { id: rowId, tenantId: event.tenantId },
  );
}
