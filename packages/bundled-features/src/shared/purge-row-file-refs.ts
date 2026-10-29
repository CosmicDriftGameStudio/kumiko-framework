import { type DbRunner, selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/db";
import type { EntityDefinition, Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable, holdsFileRefs } from "@cosmicdrift/kumiko-framework/files";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

type EntityFields = EntityDefinition["fields"];
type EntityTable = Parameters<typeof selectMany>[1];

export type FileFieldPlan = {
  /** type file|image: the fileRef-id lives directly in the entity column. */
  readonly singleFields: readonly string[];
  /** type files|images: resolved via file_refs (bound by entityType/entityId/fieldName). */
  readonly multiFields: readonly string[];
};

export type SingleFileHolder = {
  readonly table: EntityTable;
  readonly tableHasTenantId: boolean;
  readonly singleFields: readonly string[];
};

export type FileRefPurgeOutcome = "purged" | "missing_file_storage" | "file_delete_failed";

const NO_FILE_FIELDS: FileFieldPlan = { singleFields: [], multiFields: [] };

// Same set as boot-validator/entity-handler.ts FILE_FIELD_TYPES plus embedded fields with file
// sub-fields; the single/multi split matters here because only plural fields resolve through
// file_refs, bound under the top-level field name.
export function planFileFields(
  fields: EntityFields,
  fieldNames?: readonly string[],
): FileFieldPlan {
  const singleFields: string[] = [];
  const multiFields: string[] = [];
  for (const [name, field] of Object.entries(fields)) {
    if (fieldNames !== undefined && !fieldNames.includes(name)) continue;
    if (field.type === "file" || field.type === "image") singleFields.push(name);
    else if (holdsFileRefs(field)) multiFields.push(name);
  }
  return singleFields.length > 0 || multiFields.length > 0
    ? { singleFields, multiFields }
    : NO_FILE_FIELDS;
}

// Every implicit entity table with file/image fields: an unbound fileRef
// (POST /files without entityType/entityId) can sit in single fields of
// several entity types, so the sharing check must look beyond the purged
// row's own table.
export function collectSingleFileHolders(registry: Registry): readonly SingleFileHolder[] {
  const holders: SingleFileHolder[] = [];
  for (const proj of registry.getAllProjections().values()) {
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entity = registry.getEntity(proj.source);
    if (!entity) continue;
    const { singleFields } = planFileFields(entity.fields);
    if (singleFields.length === 0) continue;
    holders.push({
      table: proj.table,
      tableHasTenantId: propertyOf(proj.table, "tenantId") !== undefined,
      singleFields,
    });
  }
  return holders;
}

// Every fileRef-id a row's file-fields reference: single fields hold the id in
// their own column, plural fields resolve via file_refs (tenantId, entityType,
// entityId, fieldName).
async function collectFileRefIds(
  db: DbRunner,
  tenantId: TenantId,
  entityName: string,
  row: Record<string, unknown>,
  plan: FileFieldPlan,
): Promise<readonly string[]> {
  const ids = new Set<string>();
  for (const field of plan.singleFields) {
    const value = row[field];
    if (typeof value === "string" && value.length > 0) ids.add(value);
  }
  if (plan.multiFields.length > 0) {
    const refRows = await selectMany<{ id: string }>(db, fileRefsTable, {
      tenantId,
      entityType: entityName,
      entityId: String(row["id"]),
      fieldName: { in: plan.multiFields },
    });
    for (const r of refRows) ids.add(r.id);
  }
  return Array.from(ids);
}

// A fileRef is bound to a DIFFERENT entity/record (or, when only some fields are
// purged, to another field of this row) than the one being purged — its binding,
// not the row's own single-field column, decides ownership.
function isFileRefBoundElsewhere(
  fileRef: Record<string, unknown>,
  entityName: string,
  rowId: string,
  fieldNames: readonly string[] | undefined,
): boolean {
  const entityType = fileRef["entityType"];
  const entityId = fileRef["entityId"];
  const fieldName = fileRef["fieldName"];
  if (typeof entityType === "string" && entityType !== entityName) return true;
  if (typeof entityId === "string" && entityId !== rowId) return true;
  if (
    fieldNames !== undefined &&
    typeof fieldName === "string" &&
    !fieldNames.includes(fieldName)
  ) {
    return true;
  }
  return false;
}

// A single-field fileRef-id can be shared by more than one row, in the SAME
// table or in another entity's table; with a partial field set, also by another
// field of the same row. Purging its bytes would corrupt the holder that stays.
async function isFileRefSharedByOtherHolder(
  db: DbRunner,
  holders: readonly SingleFileHolder[],
  ownTable: EntityTable,
  tenantId: TenantId,
  rowId: string,
  fileRefId: string,
  fieldNames: readonly string[] | undefined,
): Promise<boolean> {
  for (const holder of holders) {
    for (const field of holder.singleFields) {
      const where: WhereObject = { [field]: fileRefId };
      if (holder.table === ownTable) {
        const fieldIsPurged = fieldNames === undefined || fieldNames.includes(field);
        where["id"] = fieldIsPurged ? { ne: rowId } : rowId;
      }
      if (holder.tableHasTenantId) where["tenantId"] = tenantId;
      const others = await selectMany(db, holder.table, where, { limit: 1 });
      if (others.length > 0) return true;
    }
  }
  return false;
}

// Deletes the un-shared fileRefs a row's file-fields reference: bytes (incl.
// derivatives) first, then the fileRef rows — bytes before rows so a crash
// mid-way leaves an orphaned fileRef pointing at already-gone bytes (a later
// run's delete is idempotent) rather than a gone fileRef whose bytes leak forever.
// The entity row itself is the caller's business. `fieldNames` narrows the purge
// to those fields; without it every file-field of the entity is purged.
export async function purgeRowFileRefs(args: {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
  readonly entityName: string;
  readonly entity: EntityDefinition;
  readonly table: EntityTable;
  readonly fileHolders: readonly SingleFileHolder[];
  readonly row: Record<string, unknown>;
  readonly fieldNames?: readonly string[];
  /** Returns the keys whose delete failed; undefined = no storage reachable. */
  readonly deleteBytes: ((storageKey: string) => Promise<readonly string[]>) | undefined;
  readonly fileRefForget: (fileRefId: string) => Promise<boolean>;
  readonly onBytesDeleteFailed?: (failedKeys: readonly string[]) => void;
}): Promise<FileRefPurgeOutcome> {
  const rowId = String(args.row["id"]);
  const plan = planFileFields(args.entity.fields, args.fieldNames);
  const fileRefIds = await collectFileRefIds(
    args.db,
    args.tenantId,
    args.entityName,
    args.row,
    plan,
  );
  if (fileRefIds.length === 0) return "purged";

  const fileRefRows = await selectMany<Record<string, unknown>>(args.db, fileRefsTable, {
    id: { in: fileRefIds },
    tenantId: args.tenantId,
  });

  const toDelete: Record<string, unknown>[] = [];
  for (const fileRef of fileRefRows) {
    if (isFileRefBoundElsewhere(fileRef, args.entityName, rowId, args.fieldNames)) continue;
    const shared = await isFileRefSharedByOtherHolder(
      args.db,
      args.fileHolders,
      args.table,
      args.tenantId,
      rowId,
      String(fileRef["id"]),
      args.fieldNames,
    );
    if (shared) continue;
    toDelete.push(fileRef);
  }
  if (toDelete.length === 0) return "purged";

  if (!args.deleteBytes) return "missing_file_storage";

  let anyFailed = false;
  for (const fileRef of toDelete) {
    const key = fileRef["storageKey"];
    if (typeof key !== "string" || key.length === 0) continue;
    const failedKeys = await args.deleteBytes(key);
    if (failedKeys.length > 0) {
      anyFailed = true;
      args.onBytesDeleteFailed?.(failedKeys);
    }
  }
  if (anyFailed) return "file_delete_failed";

  for (const fileRef of toDelete) {
    if (!(await args.fileRefForget(String(fileRef["id"])))) return "file_delete_failed";
  }
  return "purged";
}
