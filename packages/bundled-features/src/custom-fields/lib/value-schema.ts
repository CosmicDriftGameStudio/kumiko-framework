import {
  DEFAULT_CURRENCIES,
  type FieldDefinition,
  fieldToZod,
} from "@cosmicdrift/kumiko-framework/engine";
import type { z } from "zod";
import { SUPPORTED_FIELD_TYPES } from "../constants";

// Builds a Zod schema that validates a custom-field VALUE against its
// fieldDefinition. Reuses the framework's `fieldToZod` (Builder-Reuse /
// Stammfeld-Identität, Plan-Doc) — one field-type-schema source, no drift
// between Stammfeld- and Custom-Field-validation.
//
// Scope: type-shape only. fieldToZod also folds `required`, `maxLength`,
// `format`, and `default` into Zod refinements; we strip those before the
// call so set-custom-field rejects type-mismatches and only type-mismatches.
// Required-on-set, default-application, and length/format-enforcement remain
// out-of-scope per the Plan-Doc ("Stammfeld-Identität" lists them as
// separate concerns).
//
// Vocabulary bridge: custom-fields expose `enum` (Plan + `r.field.enum([...])`)
// where the framework's FieldDefinition calls the equivalent type `select`
// with an `options` array.
//
// Returns `null` when the serialized field is unparseable or names a type
// outside the custom-fields-supported set — callers then skip value-validation.

const SUPPORTED_TYPES_SET: ReadonlySet<string> = new Set(SUPPORTED_FIELD_TYPES);
const SUPPORTED_EMBEDDED_SUB_TYPES: ReadonlySet<string> = new Set([
  "text",
  "number",
  "boolean",
  "date",
]);

// Constraint-keys fieldToZod converts into Zod refinements. Stripped so the
// resulting schema validates the type-shape only, not the constraint.
const CONSTRAINT_KEYS = ["required", "maxLength", "format", "default"] as const;

export function buildCustomFieldValueSchema(parsedField: unknown): z.ZodTypeAny | null {
  if (!parsedField || typeof parsedField !== "object") return null;
  const obj = parsedField as Record<string, unknown>;
  const rawType = obj["type"];
  if (typeof rawType !== "string") return null;
  if (!SUPPORTED_TYPES_SET.has(rawType)) return null;

  // Embedded sub-fields: pre-check the sub-type set so we surface unknown
  // sub-types as "skip validation" (return null) rather than letting
  // fieldToZod's assertUnreachable throw and the catch swallow real bugs.
  if (rawType === "embedded") {
    const schema = obj["schema"];
    if (!schema || typeof schema !== "object") return null;
    for (const sub of Object.values(schema)) {
      if (!sub || typeof sub !== "object") return null;
      const subType = (sub as Record<string, unknown>)["type"];
      if (typeof subType !== "string" || !SUPPORTED_EMBEDDED_SUB_TYPES.has(subType)) {
        return null;
      }
    }
  }

  const fieldDef: Record<string, unknown> = { ...obj };
  for (const k of CONSTRAINT_KEYS) delete fieldDef[k];
  if (rawType === "enum") {
    fieldDef["type"] = "select";
    fieldDef["options"] = obj["values"] ?? obj["options"] ?? [];
  }

  // fieldToZod's money case validates `currency` against the passed list, not
  // a field-level key — so surface the field's own currency when it declares
  // one, else fall back to the framework defaults.
  const currencies =
    typeof obj["currency"] === "string" ? [obj["currency"] as string] : DEFAULT_CURRENCIES;

  // @cast-boundary serialized-field is the dehydrated r.field.X() output =
  // a FieldDefinition; fieldToZod reads only its type-specific keys (the
  // extra fieldAccess/sensitive/retention/label keys are ignored).
  return fieldToZod(fieldDef as unknown as FieldDefinition, currencies);
}
