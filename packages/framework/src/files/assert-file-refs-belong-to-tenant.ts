import type { SaveContext } from "@cosmicdrift/kumiko-types/hooks";
import type { Registry } from "../engine/types/index.ts";

import { ValidationError } from "../errors/index.ts";
import { fileRefIdsInField, holdsFileRefs } from "./file-field-slots.ts";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.ts";
import type { FileRefRows } from "./load-save-file-refs.ts";

// A file field only stores an id, and the file routes authorize by tenant at
// read time: without this check a writer could name another tenant's fileRef
// and make the record point at it. Only newly written values are checked (all
// of a create, `changes` of an update), so existing data is left alone. The
// error is the same for "missing" and "belongs to another tenant" so the id
// cannot be probed across tenants. `fileRefRows` holds only the writer's own
// tenant's live rows, so a missing entry is exactly those two cases. Values
// that are not UUIDs are skipped by fileRefIdsOf and never reach this check.
//
// Within the tenant, a newly named id must not be bound to a different record:
// the file routes authorize through the record a file is bound to, so naming
// record A's file in record B would hand B's readers A's file (and a later
// removal from B would not touch it). Pending uploads (no entityId), ids the
// record already holds in any file field (checked first, even if their row is gone)
// and moves between its own fields stay allowed. The error is the same as above so the owning record is not revealed.
function isBoundToOtherRecord(
  row: Readonly<Record<string, unknown>>,
  entityName: string,
  recordId: string,
): boolean {
  const boundId = row["entityId"];
  if (boundId === null || boundId === undefined) return false;
  return row["entityType"] !== entityName || boundId !== recordId;
}

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

  const recordId = String(result.id);
  const alreadyHeld = new Set<string>();
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!holdsFileRefs(fieldDef)) continue;
    for (const fileRefId of fileRefIdsInField(fieldDef, result.previous[fieldName])) {
      alreadyHeld.add(fileRefId);
    }
  }

  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    if (!holdsFileRefs(fieldDef)) continue;
    for (const fileRefId of fileRefIdsInField(fieldDef, result.changes[fieldName])) {
      // A value the record already holds is no new binding; its file_refs row may be gone
      // (forget purged the file), and sending the unchanged field back must still save.
      if (alreadyHeld.has(fileRefId)) continue;
      const row = fileRefRows.get(fileRefId);
      if (row !== undefined && !isBoundToOtherRecord(row, result.entityName, recordId)) continue;
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
