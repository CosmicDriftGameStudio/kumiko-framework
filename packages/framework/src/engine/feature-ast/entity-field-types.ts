// Shared field-type validation for EntityDefinition. Used by both the
// static extractor (extractEntity, parse-time ParseError) and the runtime
// PatternChange validator (pattern-change-schema.ts) so the two never drift
// into reporting different "unknown field type" catalogues (#3137).

import { FIELD_TYPE_NAMES } from "@cosmicdrift/kumiko-types/fields";
import { isPlainObject, isRawRefSentinel } from "./extractors/shared";

export type UnknownEntityFieldType = {
  readonly fieldName: string;
  readonly type: string;
};

/**
 * Scans `definition.fields.<name>.type` for values outside the FieldDefinition
 * catalogue. Tolerant of RawRefSentinel at every level (definition itself,
 * `fields`, a single field, or its `type`) — those are unresolvable source
 * references, not validated field shapes, and readDataLiteralNode already
 * chose not to fail the whole extraction over them.
 */
export function findUnknownEntityFieldTypes(
  definition: unknown,
): readonly UnknownEntityFieldType[] {
  if (isRawRefSentinel(definition) || !isPlainObject(definition)) return [];
  const fields = definition["fields"];
  if (isRawRefSentinel(fields) || !isPlainObject(fields)) return [];
  const out: UnknownEntityFieldType[] = [];
  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    if (isRawRefSentinel(fieldDef) || !isPlainObject(fieldDef)) continue;
    const type = fieldDef["type"];
    if (isRawRefSentinel(type) || typeof type !== "string") continue;
    if (!(FIELD_TYPE_NAMES as readonly string[]).includes(type)) {
      out.push({ fieldName, type });
    }
  }
  return out;
}

export function describeUnknownFieldType(entry: UnknownEntityFieldType): string {
  return `unknown field type "${entry.type}"; expected one of: ${FIELD_TYPE_NAMES.join(", ")}`;
}
