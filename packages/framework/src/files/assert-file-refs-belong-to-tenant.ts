import { isFileField, type Registry, type SaveContext } from "../engine/types/index.js";
import { ValidationError } from "../errors/index.js";
import { fileRefIdsOf } from "./bind-pending-file-refs.js";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.js";
import type { FileRefRows } from "./load-save-file-refs.js";

// A file field only stores an id, and the file routes authorize by tenant at
// read time: without this check a writer could name another tenant's fileRef
// and make the record point at it. Only newly written values are checked (all
// of a create, `changes` of an update), so existing data is left alone. The
// error is the same for "missing" and "belongs to another tenant" so the id
// cannot be probed across tenants. `fileRefRows` holds only the writer's own
// tenant's live rows, so a missing entry is exactly those two cases. Values
// that are not UUIDs are skipped by fileRefIdsOf and never reach this check.
export function assertFileRefsBelongToTenant(args: {
  readonly registry: Registry;
  readonly result: SaveContext;
  readonly fileRefRows: FileRefRows;
}): void {
  const { registry, result, fileRefRows } = args;
  // skip: saves of unregistered aggregates (custom executors) declare no file fields
  if (result.entityName === undefined) return;
  const entity = registry.getEntity(result.entityName);
  // skip: an aggregate without an entity definition has no file fields
  if (entity === undefined) return;
  // skip: without the files feature the file_refs table is not part of the schema
  if (registry.getEntity(FILE_REF_ENTITY_NAME) === undefined) return;

  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!isFileField(fieldDef)) continue;
    for (const fileRefId of fileRefIdsOf(result.changes[fieldName])) {
      if (fileRefRows.has(fileRefId)) continue;
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
