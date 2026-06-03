import type { DefineFieldPayload } from "../schemas";

export interface FieldDefinitionColumns {
  readonly entityName: string;
  readonly fieldKey: string;
  readonly type: string;
  readonly required: boolean;
  readonly searchable: boolean;
  readonly displayOrder: number;
  readonly serializedField: string;
}

// The required/searchable/displayOrder columns are a denormalized projection of
// serializedField — derive, don't default. Zod gives top-level `required` a
// `.default(false)`, so "caller omitted it" is indistinguishable from `false`
// post-parse; serializedField-present therefore wins to preserve caller intent.
export function buildFieldDefinitionColumns(payload: DefineFieldPayload): FieldDefinitionColumns {
  const sf = payload.serializedField;
  const required = typeof sf["required"] === "boolean" ? sf["required"] : payload.required;
  const searchable = typeof sf["searchable"] === "boolean" ? sf["searchable"] : payload.searchable;
  const displayOrder =
    typeof sf["displayOrder"] === "number" ? sf["displayOrder"] : payload.displayOrder;

  return {
    entityName: payload.entityName,
    fieldKey: payload.fieldKey,
    type: sf.type,
    required,
    searchable,
    displayOrder,
    serializedField: JSON.stringify({ ...sf, label: payload.label }),
  };
}
