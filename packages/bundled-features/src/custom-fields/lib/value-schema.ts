import {
  DEFAULT_CURRENCIES,
  type FieldDefinition,
  fieldToZod,
} from "@cosmicdrift/kumiko-framework/engine";
import type { z } from "zod";

// Builds a Zod schema that validates a custom-field VALUE against its
// fieldDefinition. Reuses the framework's `fieldToZod` (Builder-Reuse /
// Stammfeld-Identität, Plan-Doc) — one field-type-schema source, no drift
// between Stammfeld- and Custom-Field-validation.
//
// Vocabulary bridge: custom-fields expose `enum` (Plan + `r.field.enum([...])`)
// where the framework's FieldDefinition calls the equivalent type `select`
// with an `options` array. This single boundary translates it; everything
// else is already FieldDefinition-shaped (the serialized dehydrated builder).
//
// Returns `null` when the serialized field is unparseable or names a type
// `fieldToZod` cannot interpret — callers then skip value-validation rather
// than hard-rejecting a field they cannot understand.
export function buildCustomFieldValueSchema(parsedField: unknown): z.ZodTypeAny | null {
  if (!parsedField || typeof parsedField !== "object") return null;
  const obj = parsedField as Record<string, unknown>;
  if (typeof obj["type"] !== "string") return null;

  const fieldDef =
    obj["type"] === "enum"
      ? { ...obj, type: "select", options: obj["values"] ?? obj["options"] ?? [] }
      : obj;

  // fieldToZod's money case validates `currency` against the passed list, not
  // a field-level key — so surface the field's own currency when it declares
  // one, else fall back to the framework defaults.
  const currencies =
    typeof obj["currency"] === "string" ? [obj["currency"] as string] : DEFAULT_CURRENCIES;

  try {
    // @cast-boundary serialized-field is the dehydrated r.field.X() output =
    // a FieldDefinition; fieldToZod reads only its type-specific keys (the
    // extra fieldAccess/sensitive/retention/label keys are ignored).
    return fieldToZod(fieldDef as unknown as FieldDefinition, currencies);
  } catch {
    return null;
  }
}
