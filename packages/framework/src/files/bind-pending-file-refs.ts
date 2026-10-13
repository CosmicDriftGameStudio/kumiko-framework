import type { TenantDb } from "../db/tenant-db.js";
import {
  isFileField,
  isUuid,
  type Registry,
  type SaveContext,
  type SessionUser,
} from "../engine/types/index.js";
import { reraiseAsKumikoError } from "../errors/index.js";
import { getFileRefExecutor } from "./create-file-ref.js";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.js";

export function fileRefIdsOf(value: unknown): readonly string[] {
  if (typeof value === "string") return isUuid(value) ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && isUuid(item));
}

function isPendingUploadFor(
  row: Readonly<Record<string, unknown>>,
  entityName: string,
  fieldName: string,
  user: SessionUser,
): boolean {
  return (
    row["entityId"] === null &&
    row["entityType"] === entityName &&
    row["fieldName"] === fieldName &&
    row["insertedById"] === user.id
  );
}

// A form (or a server handler via createFileRefFromBytes) uploads before the
// record references the file, so its fileRefs carry entityType + fieldName but
// no entityId. Binding them in the save's own transaction makes record-bound
// variants (qr overlay) and record-read file access work for them. Only the
// caller's own pending uploads for exactly this entity field are bound: naming
// someone else's upload id in a save payload must not pull that file into a
// record the caller controls.
export async function bindPendingFileRefs(args: {
  readonly registry: Registry;
  readonly result: SaveContext;
  readonly user: SessionUser;
  readonly db: TenantDb;
}): Promise<void> {
  const { registry, result, user, db } = args;
  // skip: saves of unnamed aggregates declare no file fields
  if (result.entityName === undefined) return;
  const entityName = result.entityName;
  const entity = registry.getEntity(entityName);
  // skip: saves of unregistered aggregates (custom executors) declare no file fields
  if (entity === undefined) return;
  // skip: without the files feature the file_refs table is not part of the schema
  if (registry.getEntity(FILE_REF_ENTITY_NAME) === undefined) return;

  const executor = getFileRefExecutor();
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!isFileField(fieldDef)) continue;
    // changes, not data: an update's row carries every stored file id, including
    // ones bound earlier; only the ids this save names can be pending uploads.
    for (const fileRefId of fileRefIdsOf(result.changes[fieldName])) {
      const row = await executor.detail({ id: fileRefId }, user, db);
      if (row === null || !isPendingUploadFor(row, entityName, fieldName, user)) continue;
      const version = typeof row["version"] === "number" ? row["version"] : undefined;
      const bound = await executor.update(
        { id: fileRefId, version, changes: { entityId: String(result.id) } },
        user,
        db,
      );
      if (!bound.isSuccess) throw reraiseAsKumikoError(bound.error);
    }
  }
}
