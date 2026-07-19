// Centralised parser for `fieldDefinition.serializedField`.
//
// The column is stored as `text` in B1 (entity.ts) — what the db row hands
// back depends on the driver: postgres-js returns text as a `string`, but
// jsonb-tolerant drivers and middleware can deliver an already-parsed
// object. This helper normalises both, validates the shape, and centralises
// the single boundary cast so callers don't sprinkle `as { … }`-narrowings
// across the bundle.
//
// All structured `serializedField`-keys recognised today (`fieldAccess`,
// `retention`) live on this shape. New keys go here so the other call-sites
// can read them via the typed result instead of re-parsing.

import { parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";

export interface SerializedFieldShape {
  readonly type: string;
  readonly fieldAccess?: {
    readonly read?: ReadonlyArray<string>;
    readonly write?: ReadonlyArray<string>;
  };
  readonly retention?: {
    readonly keepFor: string;
    readonly strategy: "delete" | "anonymize";
  };
}

function isShape(v: unknown): v is SerializedFieldShape {
  if (!v || typeof v !== "object") return false;
  // `in` narrows v's type from `object` to `object & { type: unknown }` so
  // the property access below does not need a cast.
  if (!("type" in v)) return false;
  return typeof v.type === "string";
}

/**
 * Normalises the row's `serialized_field` column. Returns `null` for
 * absent/corrupt rows so callers can short-circuit cleanly without
 * having to mirror the safe-json fallback semantics themselves.
 */
export function parseSerializedField(raw: unknown): SerializedFieldShape | null {
  const parsed = typeof raw === "string" ? parseJsonSafe<unknown>(raw, null) : raw;
  if (!isShape(parsed)) return null;
  // Fail loud instead of silently dropping the key: a stored definition with
  // `sensitive` predates #972 and its PII expectations (event-log exclusion,
  // forget-strip) no longer hold — the field must be recreated.
  if ("sensitive" in parsed) {
    throw new Error(
      "custom-field definition contains the removed `sensitive` key (#972) — custom fields don't support PII. Recreate the field without it; model personal data as a schema entity field with a pii annotation.",
    );
  }
  return parsed;
}

export interface FieldDefinitionRow {
  readonly field_key: string;
  readonly serialized_field: unknown;
}

export function isFieldDefinitionRow(value: unknown): value is FieldDefinitionRow {
  if (!value || typeof value !== "object") return false;
  if (!("field_key" in value)) return false;
  return typeof value.field_key === "string";
}
