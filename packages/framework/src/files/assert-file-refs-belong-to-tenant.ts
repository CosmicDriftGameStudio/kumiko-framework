import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { SaveContext } from "@cosmicdrift/kumiko-types/hooks";
import { filterReadFields, hasOwnershipRule, restrictsAccess } from "../engine/field-access.ts";
import { normalizeAccessEntry, userCanReadFieldRow } from "../engine/ownership.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";

import { assertRowFitsFileField, isOwnUpload } from "./bind-pending-file-refs.ts";
import {
  fileRefIdsBySubField,
  fileRefIdsInField,
  holdsFileRefs,
  isFileSubField,
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
// removal from B would not touch it). Pending uploads (no entityId) and ids the field
// already holds (checked first, even if their row is gone) stay allowed. The field that holds a
// file decides who reads it, so a move from another field of the record needs read access to
// that field. The error is the same as above so the owning record is not revealed.
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

const WHOLE_FIELD_SLOT = "";

// Sub-fields of one embedded field may carry different read rules, so each counts as its own slot.
// A sub-field rule that reads its row is evaluated per row and rows have no stable id, so such a
// sub-field is a slot per row index: a file the writer may not read keeps its row. A role rule
// gives every row the same readers, so its files may change rows.
function fileRefIdsBySlot(
  fieldDef: FieldDefinition,
  value: unknown,
): ReadonlyMap<string, readonly string[]> {
  if (fieldDef.type !== "embedded") {
    return new Map([[WHOLE_FIELD_SLOT, fileRefIdsInField(fieldDef, value)]]);
  }
  const idsBySlot = new Map<string, readonly string[]>();
  const rows: readonly unknown[] = Array.isArray(value) ? value : [value];
  for (const [rowIndex, row] of rows.entries()) {
    for (const [subField, ids] of fileRefIdsBySubField(fieldDef, row)) {
      const readMap = normalizeAccessEntry(fieldDef.schema[subField]?.access?.read);
      const readsPerRow = readMap !== undefined && hasOwnershipRule(readMap);
      const slot = readsPerRow ? `${subField}[${rowIndex}]` : subField;
      idsBySlot.set(slot, [...(idsBySlot.get(slot) ?? []), ...ids]);
    }
  }
  return idsBySlot;
}

function hasReadRuleOnFileSubField(fieldDef: FieldDefinition): boolean {
  return (
    fieldDef.type === "embedded" &&
    Object.values(fieldDef.schema).some(
      (subField) =>
        isFileSubField(subField) && restrictsAccess(normalizeAccessEntry(subField.access?.read)),
    )
  );
}

function fileRefIdsInFields(
  fileFields: readonly (readonly [string, FieldDefinition])[],
  values: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [fieldName, fieldDef] of fileFields) {
    for (const fileRefId of fileRefIdsInField(fieldDef, values[fieldName])) ids.add(fileRefId);
  }
  return ids;
}

// A file bound to this record that no field holds yet (an upload with entityId, not saved) opens
// only through the field it was uploaded for, so naming it in another field needs read access to
// that field, unless the writer uploaded it. file_refs keeps only the top-level field, so when a
// file sub-field of it has its own read rule, the sub-field and row the upload was meant for are
// unknown and only the uploader may name it.
function mayNameBoundFileInField(
  row: Readonly<Record<string, unknown>>,
  fieldName: string,
  entity: EntityDefinition,
  previous: Readonly<Record<string, unknown>>,
  user: SessionUser,
): boolean {
  const boundFieldName = row["fieldName"];
  if (typeof boundFieldName !== "string") return true;
  const boundField = entity.fields[boundFieldName];
  if (boundField === undefined || isOwnUpload(row, user)) return true;
  if (hasReadRuleOnFileSubField(boundField)) return false;
  if (boundFieldName === fieldName) return true;
  return userCanReadFieldRow(user, normalizeAccessEntry(boundField.access?.read), previous);
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

type UnheldRowNaming = {
  readonly entity: EntityDefinition;
  readonly entityName: string;
  readonly recordId: string;
  readonly previous: Readonly<Record<string, unknown>>;
  readonly user: SessionUser;
  readonly claimedFileRefIds: ReadonlySet<string>;
};

// For an id no field of the record held before the save.
function mayNameUnheldRow(
  row: Readonly<Record<string, unknown>>,
  fieldName: string,
  naming: UnheldRowNaming,
): boolean {
  const { entity, entityName, recordId, previous, user, claimedFileRefIds } = naming;
  return (
    !isBoundToOtherRecord(row, entityName, recordId) &&
    mayUseRow(row, user, claimedFileRefIds) &&
    mayNameBoundFileInField(row, fieldName, entity, previous, user)
  );
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

  const naming: UnheldRowNaming = {
    entity,
    entityName: result.entityName,
    recordId: String(result.id),
    previous: result.previous,
    user,
    claimedFileRefIds,
  };
  const fileFields = Object.entries(entity.fields).filter(([, fieldDef]) =>
    holdsFileRefs(fieldDef),
  );
  const heldByRecord = fileRefIdsInFields(fileFields, result.previous);
  const heldInReadableField = fileRefIdsInFields(
    fileFields,
    filterReadFields(entity, result.previous, user),
  );
  // A sub-field rule may read the row it sits in, and the writer may rewrite the row it reads: a
  // file the writer could not read must not end up where he can, whichever slot holds it.
  const revealedToWriter = [
    ...fileRefIdsInFields(
      fileFields,
      filterReadFields(entity, { ...result.previous, ...result.changes }, user),
    ),
  ].filter((fileRefId) => heldByRecord.has(fileRefId) && !heldInReadableField.has(fileRefId));

  for (const [fieldName, fieldDef] of fileFields) {
    const previousBySlot = fileRefIdsBySlot(fieldDef, result.previous[fieldName]);
    for (const [slot, ids] of fileRefIdsBySlot(fieldDef, result.changes[fieldName])) {
      for (const fileRefId of ids) {
        if (revealedToWriter.includes(fileRefId)) throw invalidFileRefError(fieldName);
        // A value the slot already holds is no new binding; its file_refs row may be gone
        // (forget purged the file), and sending the unchanged field back must still save.
        if (previousBySlot.get(slot)?.includes(fileRefId)) continue;
        if (heldInReadableField.has(fileRefId)) continue;
        if (heldByRecord.has(fileRefId)) throw invalidFileRefError(fieldName);
        const row = fileRefRows.get(fileRefId);
        if (row !== undefined && mayNameUnheldRow(row, fieldName, naming)) continue;
        throw invalidFileRefError(fieldName);
      }
    }
    assertNewIdsFitSubFields(
      fieldDef,
      result.previous[fieldName],
      result.changes[fieldName],
      fileRefRows,
    );
  }
}
