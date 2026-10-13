import type { TenantDb } from "../db/tenant-db.js";
import {
  isFileField,
  isUuid,
  type Registry,
  type SaveContext,
  type SessionUser,
} from "../engine/types/index.js";
import { ValidationError } from "../errors/index.js";
import { fileRefIdsOf } from "./bind-pending-file-refs.js";
import { getFileRefExecutor } from "./create-file-ref.js";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.js";

// A file field only stores an id, and the file routes authorize by tenant at
// read time: without this check a writer could name another tenant's fileRef
// and make the record point at it. Only newly written values are checked (all
// of a create, `changes` of an update), so existing data is left alone. The
// error is the same for "missing" and "belongs to another tenant" so the id
// cannot be probed across tenants.
export async function assertFileRefsBelongToTenant(args: {
  readonly registry: Registry;
  readonly result: SaveContext;
  readonly user: SessionUser;
  readonly db: TenantDb;
}): Promise<void> {
  const { registry, result, user, db } = args;
  // skip: saves of unregistered aggregates (custom executors) declare no file fields
  if (result.entityName === undefined) return;
  const entity = registry.getEntity(result.entityName);
  if (entity === undefined) return;
  // skip: without the files feature the file_refs table is not part of the schema
  if (registry.getEntity(FILE_REF_ENTITY_NAME) === undefined) return;

  const executor = getFileRefExecutor();
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!isFileField(fieldDef)) continue;
    // Plural fields have no projection column, so a create's ids sit in `changes`.
    const written = result.isNew
      ? (result.data[fieldName] ?? result.changes[fieldName])
      : result.changes[fieldName];
    for (const fileRefId of fileRefIdsOf(written)) {
      if (await isFileRefOfTenant(executor, fileRefId, user, db)) continue;
      throw new ValidationError({
        fields: [
          {
            path: fieldName,
            code: "invalid_element",
            i18nKey: "errors.validation.invalid_element",
          },
        ],
      });
    }
  }
}

async function isFileRefOfTenant(
  executor: ReturnType<typeof getFileRefExecutor>,
  fileRefId: string,
  user: SessionUser,
  db: TenantDb,
): Promise<boolean> {
  if (!isUuid(fileRefId)) return false;
  // detail() widens its tenant filter to (self, SYSTEM); only the writer's own
  // tenant counts here, same as GET /files/:id/meta.
  const row = await executor.detail({ id: fileRefId }, user, db);
  return row !== null && row["tenantId"] === user.tenantId;
}
