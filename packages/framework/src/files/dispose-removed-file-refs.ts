import type { TenantDb } from "../db/tenant-db.js";
import {
  type FieldDefinition,
  isFileField,
  type Registry,
  type SaveContext,
  type SessionUser,
} from "../engine/types/index.js";
import { reraiseAsKumikoError } from "../errors/index.js";
import { fileRefIdsOf } from "./bind-pending-file-refs.js";
import { getFileRefExecutor } from "./create-file-ref.js";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.js";

// The bound fieldName may differ from the field the id was removed from: an id
// moved A -> B stays bound to A (binding never re-targets).
function isBoundToRecord(
  row: Readonly<Record<string, unknown>>,
  entityName: string,
  entityId: string,
  fileFields: Readonly<Record<string, FieldDefinition>>,
): boolean {
  const boundField = row["fieldName"];
  return (
    row["entityType"] === entityName &&
    row["entityId"] === entityId &&
    typeof boundField === "string" &&
    isFileField(fileFields[boundField])
  );
}

// Across all file fields: an id moved from one field to another is still in use.
function fileRefIdsStoredInAnyField(
  fields: Readonly<Record<string, FieldDefinition>>,
  data: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    if (!isFileField(fieldDef)) continue;
    for (const fileRefId of fileRefIdsOf(data[fieldName])) ids.add(fileRefId);
  }
  return ids;
}

// An update that drops or replaces a file id leaves the fileRef readable to
// everyone who may read the record. Deleting it goes through the same executor
// path as DELETE /files/:id (soft delete, bytes kept until retention), so
// record readers get 404 afterwards. Only fileRefs bound to exactly this
// record are touched: an id that is pending, shared or bound
// elsewhere is not this save's to dispose. The authority is the caller's write
// right on the record (the fileRef entity declares no write access of its own).
export async function disposeRemovedFileRefs(args: {
  readonly registry: Registry;
  readonly result: SaveContext;
  readonly user: SessionUser;
  readonly db: TenantDb;
}): Promise<void> {
  const { registry, result, user, db } = args;
  // skip: a create has no earlier files that could be removed
  if (result.isNew) return;
  // skip: saves of unnamed aggregates declare no file fields
  if (result.entityName === undefined) return;
  const entityName = result.entityName;
  const entity = registry.getEntity(entityName);
  // skip: saves of unregistered aggregates (custom executors) declare no file fields
  if (entity === undefined) return;
  // skip: without the files feature the file_refs table is not part of the schema
  if (registry.getEntity(FILE_REF_ENTITY_NAME) === undefined) return;

  const entityId = String(result.id);
  const executor = getFileRefExecutor();
  const keptAnywhere = fileRefIdsStoredInAnyField(entity.fields, result.data);
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!isFileField(fieldDef) || !(fieldName in result.changes)) continue;
    for (const fileRefId of fileRefIdsOf(result.previous[fieldName])) {
      if (keptAnywhere.has(fileRefId)) continue;
      const row = await executor.detail({ id: fileRefId }, user, db);
      if (row === null || !isBoundToRecord(row, entityName, entityId, entity.fields)) continue;
      const removed = await executor.delete({ id: fileRefId }, user, db);
      if (!removed.isSuccess) throw reraiseAsKumikoError(removed.error);
    }
  }
}
