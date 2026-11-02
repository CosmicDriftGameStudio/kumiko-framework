import type { FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { SaveContext } from "@cosmicdrift/kumiko-types/hooks";
import type { Registry, SessionUser } from "../engine/types/index.ts";

import { assertRowFitsFileField, isOwnUpload } from "./bind-pending-file-refs.ts";
import {
  fileRefIdsBySubField,
  fileRefIdsInField,
  holdsFileRefs,
  resolveFileSubField,
} from "./file-field-slots.ts";
import { FILE_REF_ENTITY_NAME } from "./file-ref-entity.ts";
import { invalidFileRefError } from "./invalid-file-ref-error.ts";
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

// A file sub-field may be stricter than the sibling the upload came in through (`images` next
// to `files`); the upload was only checked against the sub-field it named. Ids a sub-field
// already held are not re-checked, a move from another sub-field counts as new.
function assertNewIdsFitSubFields(
  fieldDef: FieldDefinition,
  previous: unknown,
  changes: unknown,
  fileRefRows: FileRefRows,
): void {
  const previousBySubField = fileRefIdsBySubField(fieldDef, previous);
  for (const [subField, ids] of fileRefIdsBySubField(fieldDef, changes)) {
    const subFieldDef = resolveFileSubField(fieldDef, subField);
    if (subFieldDef === undefined) continue;
    for (const fileRefId of ids) {
      if (previousBySubField.get(subField)?.includes(fileRefId)) continue;
      const row = fileRefRows.get(fileRefId);
      if (row !== undefined) assertRowFitsFileField(row, subFieldDef);
    }
  }
}

// A pending upload (no record yet) is usable by the uploader or by whoever proved the claim of
// its handle; a visitor-owned upload is nobody's by user id, so a bare id never suffices.
function mayUseRow(
  row: Readonly<Record<string, unknown>>,
  user: SessionUser,
  claimedFileRefIds: ReadonlySet<string>,
): boolean {
  const isPending = row["entityId"] === null || row["entityId"] === undefined;
  return !isPending || isOwnUpload(row, user) || claimedFileRefIds.has(String(row["id"]));
}

export function assertFileRefsBelongToTenant(args: {
  readonly registry: Registry;
  readonly result: SaveContext;
  readonly user: SessionUser;
  readonly fileRefRows: FileRefRows;
}): void {
  const { registry, result, user, fileRefRows } = args;
  const claimedFileRefIds = new Set(result.claimedFileRefIds);
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
      if (
        row !== undefined &&
        !isBoundToOtherRecord(row, result.entityName, recordId) &&
        mayUseRow(row, user, claimedFileRefIds)
      ) {
        continue;
      }
      throw invalidFileRefError(fieldName);
    }
    assertNewIdsFitSubFields(
      fieldDef,
      result.previous[fieldName],
      result.changes[fieldName],
      fileRefRows,
    );
  }
}
