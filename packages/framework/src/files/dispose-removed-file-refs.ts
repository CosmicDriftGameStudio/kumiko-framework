import type { TenantDb } from "../db/tenant-db.js";
import {
  isFileField,
  type Registry,
  type SaveContext,
  type SessionUser,
} from "../engine/types/index.js";
import { reraiseAsKumikoError } from "../errors/index.js";
import { fileRefIdsOf } from "./bind-pending-file-refs.js";
import { getFileRefExecutor } from "./create-file-ref.js";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.js";

function isBoundTo(
  row: Readonly<Record<string, unknown>>,
  entityName: string,
  entityId: string,
  fieldName: string,
): boolean {
  return (
    row["entityType"] === entityName &&
    row["entityId"] === entityId &&
    row["fieldName"] === fieldName
  );
}

// An update that drops or replaces a file id leaves the fileRef readable to
// everyone who may read the record. Deleting it goes through the same executor
// path as DELETE /files/:id (soft delete, bytes kept until retention), so
// record readers get 404 afterwards. Only fileRefs bound to exactly this
// record and field are touched: an id that is pending, shared or bound
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
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!isFileField(fieldDef) || !(fieldName in result.changes)) continue;
    const kept = new Set(fileRefIdsOf(result.data[fieldName]));
    for (const fileRefId of fileRefIdsOf(result.previous[fieldName])) {
      if (kept.has(fileRefId)) continue;
      const row = await executor.detail({ id: fileRefId }, user, db);
      if (row === null || !isBoundTo(row, entityName, entityId, fieldName)) continue;
      const removed = await executor.delete({ id: fileRefId }, user, db);
      if (!removed.isSuccess) throw reraiseAsKumikoError(removed.error);
    }
  }
}
