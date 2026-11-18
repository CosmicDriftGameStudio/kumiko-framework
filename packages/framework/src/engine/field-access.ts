import type {
  EmbeddedFieldDef,
  EntityDefinition,
  FieldDefinition,
} from "@cosmicdrift/kumiko-types/fields";
import type { DbRow } from "../db/connection.ts";
import { isFileSubField } from "../files/file-field-slots.ts";
import {
  normalizeAccessEntry,
  type OwnershipMap,
  userCanReadFieldRow,
  userCanWriteFieldRow,
} from "./ownership.ts";
import { isUnchangedValue } from "./screen-helpers.ts";
import type { SessionUser } from "./types/index.ts";

function writeOnlyFieldNames(entity: EntityDefinition): readonly string[] {
  const names: string[] = [];
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type === "text" && field.writeOnly === true) names.push(name);
  }
  return names;
}

function maskWriteOnlyValue(value: unknown): true | null {
  return value === null || value === undefined || value === "" ? null : true;
}

// writeOnly text fields never leave the server as plaintext: set -> true,
// empty -> null. Only keys present in the row are touched (a partial `changes`
// stays partial). Returns the same object when the entity has no such field.
export function maskWriteOnlyFields<T extends Readonly<Record<string, unknown>>>(
  entity: EntityDefinition,
  row: T,
): T {
  const names = writeOnlyFieldNames(entity);
  if (names.length === 0) return row;
  const masked: Record<string, unknown> = { ...row };
  for (const name of names) {
    if (name in masked) masked[name] = maskWriteOnlyValue(masked[name]);
  }
  return masked as T; // @cast-boundary engine-payload
}

// Write payloads: "" on a writeOnly field means "unchanged" (an untouched
// masked input submits it), so the key is dropped before the executor sees it.
export function dropEmptyWriteOnlyValues<T extends Readonly<Record<string, unknown>>>(
  entity: EntityDefinition,
  values: T,
): T {
  const names = writeOnlyFieldNames(entity).filter((name) => values[name] === "");
  if (names.length === 0) return values;
  const kept: Record<string, unknown> = { ...values };
  for (const name of names) delete kept[name];
  return kept as T; // @cast-boundary engine-payload
}

/** True if filterReadFields strips or masks the field for some readers: an `access.read` rule
 *  (array or record form), a writeOnly text field, or an embedded sub-field with its own
 *  `access.read`. */
export function isReadRestrictedField(field: FieldDefinition): boolean {
  if (field.access?.read !== undefined) return true;
  if (field.type === "text" && field.writeOnly === true) return true;
  return (
    field.type === "embedded" &&
    Object.values(field.schema).some((subField) => subField.access?.read !== undefined)
  );
}

// Role-level gate for bulk exports: false for writeOnly fields and for fields whose read-access
// map grants none of the user's roles. Per-row ownership rules are not evaluated here; those
// cells come back empty from the list query itself.
export function userMayReadFieldInBulk(
  entity: EntityDefinition,
  fieldName: string,
  user: Pick<SessionUser, "roles">,
): boolean {
  const field = entity.fields[fieldName];
  if (!field) return false;
  if (field.type === "text" && field.writeOnly === true) return false;
  const accessMap = normalizeAccessEntry(field.access?.read);
  return accessMap === undefined || user.roles.some((role) => accessMap[role] !== undefined);
}

// Field-level read filtering. Returns a copy of `data` with fields stripped
// if the user's roles don't grant read access OR the ownership-rule for the
// matching role doesn't accept this concrete row. Fields without access
// config are visible to everyone.
//
// Removal is silent (field simply not present in the output) — this is the
// one place in the ownership system where silence is the right default:
// reporting "you tried to read X but can't" leaks the field's existence.
// Writes do the opposite (loud error) because a silent drop there masks
// save-bugs.
//
// `ruleRow` is what a field rule is evaluated against; a partial `changes` passes the full row.
export function filterReadFields(
  entity: EntityDefinition,
  data: Readonly<Record<string, unknown>>,
  user: SessionUser,
  ruleRow: Readonly<Record<string, unknown>> = data,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const field = entity.fields[key];
    if (!field) {
      // Base columns (id, tenantId, version, etc.) — always visible
      result[key] = value;
      continue;
    }

    const accessMap = normalizeAccessEntry(field.access?.read);
    if (!userCanReadFieldRow(user, accessMap, ruleRow)) {
      continue; // entire field stripped
    }

    if (field.type === "text" && field.writeOnly === true) {
      result[key] = maskWriteOnlyValue(value);
      continue;
    }

    // For embedded fields: filter sub-fields with access restrictions.
    // A list-embedded value is an array of rows — each row is filtered on its
    // own, so a sub-field rule can reference the row it sits in. Filtering the
    // array as if it were one object would turn it into `{0: …, 1: …}`.
    if (field.type === "embedded" && value && typeof value === "object") {
      const filterRow = (row: DbRow): Record<string, unknown> => {
        const filtered: Record<string, unknown> = {};
        for (const [subKey, subValue] of Object.entries(row)) {
          const subField = field.schema[subKey];
          const subAccess = normalizeAccessEntry(subField?.access?.read);
          if (!userCanReadFieldRow(user, subAccess, row)) continue;
          filtered[subKey] = subValue;
        }
        return filtered;
      };
      result[key] = Array.isArray(value)
        ? value.map((row) => (row && typeof row === "object" ? filterRow(row as DbRow) : row))
        : filterRow(value as DbRow);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Role-only field-write check. Evaluates ONLY whether the user has at
// least one role mapped to the field's write-access — does NOT evaluate
// ownership rules against a row. The dispatcher calls this before the
// handler runs to catch clear-cut role denials (the common case), without
// needing to load old-row state.
//
// Ownership-level row-match for updates happens in the executor, where
// the pre-update row is already loaded. See checkWriteFieldOwnership.
//
// Returns the denied field name, or null if all fields pass the role gate.
export function checkWriteFieldRoles(
  entity: EntityDefinition,
  changes: Readonly<Record<string, unknown>>,
  user: SessionUser,
): string | null {
  for (const key of Object.keys(changes)) {
    const field = entity.fields[key];
    if (!field) continue;

    const accessMap = normalizeAccessEntry(field.access?.write);
    if (!accessMap) continue; // public write

    // Pure role-in-map check — ownership-rule evaluation is deferred.
    const hasRole = user.roles.some((role) => accessMap[role] !== undefined);
    if (!hasRole) return key;
  }
  return null;
}

// Full ownership-aware field-write check. Called from the executor after
// oldRow is loaded. Enforces Straddle-safe per-role atomicity: at least one
// of the user's roles must accept BOTH the old row AND the new (post-change)
// row. For creates, pass oldRow = undefined; the check degenerates to a
// newRow-only evaluation.
//
// `submittedChanges` and `rowContext` are deliberately separate:
// - `submittedChanges` drives WHICH fields get checked — only what the user
//   actually wrote in the request. A preSave-hook-derived field the user
//   never touched (e.g. a system hook setting `assignedTo`) must not be
//   field-ownership-checked against the user at all.
// - `rowContext` drives what a checked field's rule is evaluated AGAINST —
//   this needs the full post-hook row, because an ownership rule can
//   reference a DIFFERENT column that only a hook populates (a hook derives
//   `authorId`, a user-submitted `secretNote` field's rule is `from("user:id", "authorId")`
//   — the check needs the hook-derived `authorId` in scope even though the
//   user only wrote `secretNote`). Defaults to `submittedChanges` when omitted.
//
// Returns the denied field name for the caller to wrap into an
// `ownership_denied` error with scope: "field", or null if all fields pass.
export function checkWriteFieldOwnership(
  entity: EntityDefinition,
  submittedChanges: Readonly<Record<string, unknown>>,
  user: SessionUser,
  oldRow?: Readonly<Record<string, unknown>>,
  rowContext: Readonly<Record<string, unknown>> = submittedChanges,
  // Off for the nested-write parent check: it asserts ownership of an existing row, nothing is
  // being written to its embedded sub-fields.
  checkEmbeddedSubFields = true,
): string | null {
  for (const key of Object.keys(submittedChanges)) {
    const field = entity.fields[key];
    if (!field) continue;

    if (field.type === "embedded" && checkEmbeddedSubFields) {
      const deniedSubField = deniedEmbeddedSubField(
        field,
        submittedChanges[key],
        oldRow?.[key],
        user,
      );
      if (deniedSubField) return `${key}.${deniedSubField}`;
    }

    const accessMap = normalizeAccessEntry(field.access?.write);
    // Pure "all" maps are just role-in-map checks, already verified by the dispatcher.
    if (!accessMap || !hasOwnershipRule(accessMap)) continue;

    const newRow: Record<string, unknown> = { ...(oldRow ?? {}), ...rowContext };
    const effectiveOld = oldRow ?? newRow; // create: compare against newRow

    if (!userCanWriteFieldRow(user, accessMap, effectiveOld, newRow)) {
      return key;
    }
  }
  return null;
}

// At least one role's rule reads the row, so the same field may differ in access between rows.
export function hasOwnershipRule(accessMap: OwnershipMap): boolean {
  return Object.values(accessMap).some((rule) => rule !== "all");
}

// Role gate without a row: the user holds at least one role the map grants.
export function userHasWriteRole(
  user: Pick<SessionUser, "roles">,
  accessMap: OwnershipMap,
): boolean {
  return user.roles.some((role) => accessMap[role] !== undefined);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function embeddedRows(value: unknown): readonly (Readonly<Record<string, unknown>> | undefined)[] {
  if (Array.isArray(value)) return value.map((row) => (isRecord(row) ? row : undefined));
  return isRecord(value) ? [value] : [];
}

// Sub-field write rules of an embedded field, enforced on save. Rows are paired by index;
// a sub-field counts as written when its value differs between old and new row (an added or
// removed row that carries a value counts too). The rule is evaluated against the embedded
// row, as the read filter does. Returns the denied sub-field name or null.
function deniedEmbeddedSubField(
  field: EmbeddedFieldDef,
  newValue: unknown,
  oldValue: unknown,
  user: SessionUser,
): string | null {
  const newRows = embeddedRows(newValue);
  const oldRows = embeddedRows(oldValue);
  for (const [subKey, subField] of Object.entries(field.schema)) {
    const accessMap = normalizeAccessEntry(subField.access?.write);
    if (!accessMap) continue;
    for (let i = 0; i < Math.max(newRows.length, oldRows.length); i++) {
      const newRow = newRows[i];
      const oldRow = oldRows[i];
      if (isUnchangedValue(newRow?.[subKey], oldRow?.[subKey])) continue;
      const rowAfter = newRow ?? oldRow ?? {};
      if (!userCanWriteFieldRow(user, accessMap, oldRow ?? rowAfter, rowAfter)) return subKey;
    }
  }
  return null;
}

// userCanReadFieldRow reads an empty map (and `read: []`, which normalizes to none) as public.
export function restrictsAccess(accessMap: OwnershipMap | undefined): accessMap is OwnershipMap {
  return accessMap !== undefined && Object.keys(accessMap).length > 0;
}

function isEmptySubFieldValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

type SubFieldReadRule = readonly [subKey: string, readMap: OwnershipMap];

function subFieldReadRules(field: EmbeddedFieldDef): readonly SubFieldReadRule[] {
  const rules: SubFieldReadRule[] = [];
  for (const [subKey, subField] of Object.entries(field.schema)) {
    const readMap = normalizeAccessEntry(subField.access?.read);
    if (restrictsAccess(readMap)) rules.push([subKey, readMap]);
  }
  return rules;
}

function subFieldsHiddenInRow(
  rules: readonly SubFieldReadRule[],
  row: Readonly<Record<string, unknown>>,
  user: SessionUser,
): readonly string[] {
  return rules
    .filter(([, readMap]) => !userCanReadFieldRow(user, readMap, row))
    .map(([subKey]) => subKey);
}

function holdsHiddenValue(
  rules: readonly SubFieldReadRule[],
  row: Readonly<Record<string, unknown>>,
  user: SessionUser,
): boolean {
  return subFieldsHiddenInRow(rules, row, user).some(
    (subKey) => !isEmptySubFieldValue(row[subKey]),
  );
}

function withValuesOfPreviousRow(
  row: Readonly<Record<string, unknown>>,
  previousRow: Readonly<Record<string, unknown>>,
  subKeys: readonly string[],
): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...row };
  for (const subKey of subKeys) {
    if (subKey in previousRow) kept[subKey] = previousRow[subKey];
    else delete kept[subKey];
  }
  return kept;
}

function keptEmbeddedValue(
  value: unknown,
  previousRows: readonly (Readonly<Record<string, unknown>> | undefined)[],
  rules: readonly SubFieldReadRule[],
  user: SessionUser,
): unknown {
  const keepRow = (row: unknown, index: number): unknown => {
    const previousRow = previousRows[index];
    if (!isRecord(row) || previousRow === undefined) return row;
    return withValuesOfPreviousRow(
      row,
      previousRow,
      subFieldsHiddenInRow(rules, previousRow, user),
    );
  };
  return Array.isArray(value) ? value.map(keepRow) : keepRow(value, 0);
}

// A row rule reads columns the writer may rewrite: a kept value must not land in a row he reads.
function revealsHiddenValue(
  keptValue: unknown,
  previousRows: readonly (Readonly<Record<string, unknown>> | undefined)[],
  rules: readonly SubFieldReadRule[],
  user: SessionUser,
): boolean {
  return embeddedRows(keptValue).some((row, index) => {
    const previousRow = previousRows[index];
    if (row === undefined || previousRow === undefined) return false;
    const stillHidden = subFieldsHiddenInRow(rules, row, user);
    return subFieldsHiddenInRow(rules, previousRow, user).some(
      (subKey) => !isEmptySubFieldValue(previousRow[subKey]) && !stillHidden.includes(subKey),
    );
  });
}

// An empty or missing value is what a client sends for a sub-field it never got. Any other value
// is refused even when it equals the hidden one, so a save cannot confirm a guess; only unchanged
// file ids pass, since a random id cannot be guessed and a client may name the file it holds.
function sendsValueAtHiddenPlace(
  field: EmbeddedFieldDef,
  value: unknown,
  previousRows: readonly (Readonly<Record<string, unknown>> | undefined)[],
  rules: readonly SubFieldReadRule[],
  user: SessionUser,
): boolean {
  const sendsValue = (subKey: string, sent: unknown, previousValue: unknown): boolean => {
    if (isEmptySubFieldValue(sent)) return false;
    const subField = field.schema[subKey];
    return !(
      subField !== undefined &&
      isFileSubField(subField) &&
      isUnchangedValue(sent, previousValue)
    );
  };
  return embeddedRows(value).some((row, index) => {
    const previousRow = previousRows[index];
    if (row === undefined || previousRow === undefined) return false;
    return subFieldsHiddenInRow(rules, previousRow, user).some((subKey) =>
      sendsValue(subKey, row[subKey], previousRow[subKey]),
    );
  });
}

export type HiddenSubFieldsKept =
  | { readonly kind: "kept"; readonly changes: Record<string, unknown> }
  | { readonly kind: "hiddenRowDropped" | "hiddenRowChanged"; readonly fieldName: string };

// The read path hands a writer embedded rows without the sub-fields he may not read, and saving
// them replaces the whole field. Rows have no stable id, so each row index keeps the hidden values
// of the row it held before; dropping a row that holds a hidden value, sending a value there or
// revealing one is refused instead of losing it. The rule is evaluated against the previous row, as on read.
export function keepHiddenEmbeddedSubFields(
  entity: EntityDefinition,
  changes: Readonly<Record<string, unknown>>,
  previous: Readonly<Record<string, unknown>>,
  user: SessionUser,
): HiddenSubFieldsKept {
  const kept: Record<string, unknown> = { ...changes };
  for (const [fieldName, value] of Object.entries(changes)) {
    const field = entity.fields[fieldName];
    if (field?.type !== "embedded") continue;
    const rules = subFieldReadRules(field);
    if (rules.length === 0) continue;
    const previousRows = embeddedRows(previous[fieldName]);
    const sentRowCount = embeddedRows(value).length;
    const droppedRows = previousRows.slice(sentRowCount);
    if (droppedRows.some((row) => row !== undefined && holdsHiddenValue(rules, row, user))) {
      return { kind: "hiddenRowDropped", fieldName };
    }
    if (sendsValueAtHiddenPlace(field, value, previousRows, rules, user)) {
      return { kind: "hiddenRowChanged", fieldName };
    }
    const keptValue = keptEmbeddedValue(value, previousRows, rules, user);
    if (revealsHiddenValue(keptValue, previousRows, rules, user)) {
      return { kind: "hiddenRowChanged", fieldName };
    }
    kept[fieldName] = keptValue;
  }
  return { kind: "kept", changes: kept };
}
