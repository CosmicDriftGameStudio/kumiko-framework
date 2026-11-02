import { isUuid } from "@cosmicdrift/kumiko-types/identifiers";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { isFileField } from "../engine/field-helpers.ts";
import type {
  EmbeddedFieldDef,
  EmbeddedFileSubFieldDef,
  EmbeddedSubFieldDef,
  FieldDefinition,
} from "../engine/types/fields.ts";

export function fileRefIdsOf(value: unknown): readonly string[] {
  if (typeof value === "string") return isUuid(value) ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && isUuid(item));
}

export function isFileSubField(sub: EmbeddedSubFieldDef): sub is EmbeddedFileSubFieldDef {
  return sub.type === "images" || sub.type === "files";
}

function fileSubFieldNames(def: EmbeddedFieldDef): readonly string[] {
  return Object.entries(def.schema).flatMap(([name, sub]) => (isFileSubField(sub) ? [name] : []));
}

/** A field whose value carries FileRef ids: a file field itself, or an embedded field with file sub-fields. */
export function holdsFileRefs(def: FieldDefinition | undefined): boolean {
  if (def === undefined) return false;
  if (isFileField(def)) return true;
  return def.type === "embedded" && Object.values(def.schema).some(isFileSubField);
}

/** FileRef ids a field value names. `file_refs.fieldName` stays the top-level field, never the sub-field. */
export function fileRefIdsInField(def: FieldDefinition | undefined, value: unknown): string[] {
  if (def === undefined) return [];
  if (isFileField(def)) return [...fileRefIdsOf(value)];
  if (def.type !== "embedded") return [];
  const subNames = fileSubFieldNames(def);
  const rows = Array.isArray(value) ? value : [value];
  return rows.flatMap((row) =>
    isPlainObject(row) ? subNames.flatMap((name) => fileRefIdsOf(row[name])) : [],
  );
}

/** The field value with every string in a file slot replaced by `map(entry)`; other values pass through. */
export function mapFileRefSlots(
  def: FieldDefinition | undefined,
  value: unknown,
  map: (entry: string) => string,
): unknown {
  const mapSlot = (slot: unknown): unknown => {
    if (typeof slot === "string") return map(slot);
    return Array.isArray(slot)
      ? slot.map((entry) => (typeof entry === "string" ? map(entry) : entry))
      : slot;
  };
  if (def === undefined) return value;
  if (isFileField(def)) return mapSlot(value);
  if (def.type !== "embedded") return value;
  const subNames = fileSubFieldNames(def);
  const mapRow = (row: unknown): unknown => {
    if (!isPlainObject(row)) return row;
    const mapped: Record<string, unknown> = { ...row };
    for (const name of subNames) {
      if (name in mapped) mapped[name] = mapSlot(mapped[name]);
    }
    return mapped;
  };
  return Array.isArray(value) ? value.map(mapRow) : mapRow(value);
}

/** FileRef ids per file sub-field of an embedded field value, pooled over all rows. */
export function fileRefIdsBySubField(
  def: FieldDefinition | undefined,
  value: unknown,
): ReadonlyMap<string, readonly string[]> {
  const bySubField = new Map<string, readonly string[]>();
  if (def?.type !== "embedded") return bySubField;
  const rows = Array.isArray(value) ? value : [value];
  for (const name of fileSubFieldNames(def)) {
    bySubField.set(
      name,
      rows.flatMap((row) => (isPlainObject(row) ? fileRefIdsOf(row[name]) : [])),
    );
  }
  return bySubField;
}

export function resolveFileSubField(
  def: FieldDefinition | undefined,
  subField: string,
): EmbeddedFileSubFieldDef | undefined {
  if (def?.type !== "embedded") return undefined;
  const sub = def.schema[subField];
  return sub !== undefined && isFileSubField(sub) ? sub : undefined;
}
