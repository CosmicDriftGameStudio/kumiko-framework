// Screen-Filter — operator-to-field-type compatibility.
//
// Allowed operators depend on the field type:
//   - text/select/multiSelect: equality operators only (eq, ne, in). lt/gt
//     on strings are usually accidental; authors can simply omit the filter.
import type { FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { ScreenFilterOp } from "@cosmicdrift/kumiko-types/screen";

//   - boolean: eq, ne (in/lt/gt are meaningless for a two-value type).
//   - number/money/decimal/date/timestamp/locatedTimestamp: all 7 operators,
//     because these fields are naturally comparable.
//
// The boot validator uses this map to catch authoring errors early
// ("filter with op:lt on a text field" → boot failure). When adding a field
// type, add it here and set its sortable/filterable flag in the type definition;
// otherwise the validator rejects the field entirely.
const EQUALITY_ONLY = ["eq", "ne", "in"] as const satisfies readonly ScreenFilterOp[];
const COMPARABLE = [
  "eq",
  "ne",
  "lt",
  "gt",
  "lte",
  "gte",
  "in",
] as const satisfies readonly ScreenFilterOp[];
const BOOL_OPS = ["eq", "ne"] as const satisfies readonly ScreenFilterOp[];

export function getAllowedFilterOps(field: FieldDefinition): readonly ScreenFilterOp[] {
  switch (field.type) {
    case "text":
    case "select":
    case "multiSelect":
      return EQUALITY_ONLY;
    case "reference":
      return field.multiple === true ? EQUALITY_ONLY : [];
    case "boolean":
      return BOOL_OPS;
    case "number":
    case "money":
    case "decimal":
    case "date":
    case "timestamp":
    case "locatedTimestamp":
      return COMPARABLE;
    // tz/embedded/file/image/files/images: not filterable — authors cannot
    // mark the field as filterable: true because the boot validator already
    // rejects `filterable: true` for these types; the flag is not present in
    // their type definitions.
    default:
      return [];
  }
}

// If an author marked the field as filterable, catch types without that
// flag in their type definition with the `"filterable" in field` narrowing.
export function isFieldFilterable(field: FieldDefinition): boolean {
  return "filterable" in field && field.filterable === true;
}
