import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { evalFieldCondition, isUnchangedValue } from "./screen-helpers.ts";
import type { FieldDefinition, FieldStateConditions } from "./types/fields.ts";

type RequiredState = FieldStateConditions & { readonly required?: boolean };

export function isMissingRequiredValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function isFieldVisible(
  def: FieldStateConditions,
  values: Record<string, unknown>,
): boolean {
  return def.visibleWhen === undefined || evalFieldCondition(def.visibleWhen, values);
}

export function isFieldRequired(def: RequiredState, values: Record<string, unknown>): boolean {
  if (!isFieldVisible(def, values)) return false;
  return (
    def.required === true ||
    (def.requiredWhen !== undefined && evalFieldCondition(def.requiredWhen, values))
  );
}

function watchedKeys(name: string, def: FieldStateConditions): readonly string[] {
  return [
    name,
    ...(def.requiredWhen ? [def.requiredWhen.field] : []),
    ...(def.visibleWhen ? [def.visibleWhen.field] : []),
  ];
}

function embeddedRowsOf(def: Extract<FieldDefinition, { type: "embedded" }>, value: unknown) {
  if (def.multiple === true)
    return Array.isArray(value) ? value.map((row, index) => ({ row, index })) : [];
  return isPlainObject(value) ? [{ row: value, index: undefined }] : [];
}

function findMissingEmbeddedRequirements(
  name: string,
  def: Extract<FieldDefinition, { type: "embedded" }>,
  value: unknown,
): string[] {
  const missing: string[] = [];
  for (const { row, index } of embeddedRowsOf(def, value)) {
    if (!isPlainObject(row)) continue;
    for (const [subName, sub] of Object.entries(def.schema)) {
      if (sub.requiredWhen === undefined) continue;
      if (!isFieldRequired(sub, row) || !isMissingRequiredValue(row[subName])) continue;
      missing.push(index === undefined ? `${name}.${subName}` : `${name}.${index}.${subName}`);
    }
  }
  return missing;
}

/** Paths of fields (and embedded sub-fields) whose `requiredWhen` holds while the value is missing.
 *  With `previous`, a field is only checked when it or one of its condition fields changed, so
 *  legacy rows stay editable. */
export function findMissingConditionalRequirements(
  fields: Readonly<Record<string, FieldDefinition>>,
  values: Record<string, unknown>,
  previous?: Record<string, unknown>,
): readonly string[] {
  const missing: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (!isFieldVisible(def, values)) continue;
    if (def.requiredWhen !== undefined) {
      const unchanged =
        previous !== undefined &&
        watchedKeys(name, def).every((key) => isUnchangedValue(values[key], previous[key]));
      if (!unchanged && isFieldRequired(def, values) && isMissingRequiredValue(values[name])) {
        missing.push(name);
      }
    }
    if (def.type !== "embedded") continue;
    if (previous !== undefined && isUnchangedValue(values[name], previous[name])) continue;
    missing.push(...findMissingEmbeddedRequirements(name, def, values[name]));
  }
  return missing;
}
