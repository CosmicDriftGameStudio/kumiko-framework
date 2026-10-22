import {
  DEFAULT_CURRENCIES,
  type FieldDefinition,
  fieldToZod,
} from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type * as z from "zod";
import { SUPPORTED_FIELD_TYPES } from "../web/constants.ts";

// Builds a Zod schema that validates a custom-field VALUE against its
// fieldDefinition. Reuses the framework's `fieldToZod` so built-in and
// custom-field validation share one field-type schema source.
//
// Scope: type-shape only. `fieldToZod` also folds `required`, `maxLength`,
// `format`, and `default` into Zod refinements; stripping them before the
// call ensures that setting a custom field rejects only type mismatches.
// Required-on-set, default application, and length/format enforcement remain
// separate concerns.
//
// Vocabulary bridge: custom fields expose `enum` through `r.field.enum([...])`,
// while the framework's FieldDefinition calls the equivalent type `select`
// with an `options` array.
//
// Returns `null` when the serialized field is unparseable or names a type
// outside the custom-fields-supported set, allowing callers to skip validation.

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
  if (!isPlainObject(parsedField)) return null;
  const rawType = parsedField["type"];
  if (typeof rawType !== "string") return null;
  if (!SUPPORTED_TYPES_SET.has(rawType)) return null;

  // Embedded sub-fields: pre-check the sub-type set so we surface unknown
  // sub-types as "skip validation" (return null) rather than letting
  // fieldToZod's assertUnreachable throw and the catch swallow real bugs.
  // Build a constraint-stripped copy of each sub-field in the same pass —
  // symmetric with the top-level strip below. Without it a sub-field's
  // `required` folds into z.string().min(1) + non-optional, re-enforcing a
  // constraint the contract ("type-mismatches and ONLY type-mismatches")
  // drops everywhere else.
  let strippedSubSchema: Record<string, Record<string, unknown>> | undefined;
  if (rawType === "embedded") {
    const schema = parsedField["schema"];
    if (!schema || typeof schema !== "object") return null;
    strippedSubSchema = {};
    for (const [subKey, sub] of Object.entries(schema)) {
      if (!isPlainObject(sub)) return null;
      const subType = sub["type"];
      if (typeof subType !== "string" || !SUPPORTED_EMBEDDED_SUB_TYPES.has(subType)) {
        return null;
      }
      const strippedSub = { ...sub };
      for (const k of CONSTRAINT_KEYS) delete strippedSub[k];
      strippedSubSchema[subKey] = strippedSub;
    }
  }

  const fieldDef: Record<string, unknown> = { ...parsedField };
  for (const k of CONSTRAINT_KEYS) delete fieldDef[k];
  if (strippedSubSchema !== undefined) fieldDef["schema"] = strippedSubSchema;
  if (rawType === "enum") {
    fieldDef["type"] = "select";
    fieldDef["options"] = parsedField["values"] ?? parsedField["options"] ?? [];
  }

  // fieldToZod's money case validates `currency` against the passed list, not
  // a field-level key — so surface the field's own currency when it declares
  // one, else fall back to the framework defaults.
  const currencies =
    typeof parsedField["currency"] === "string" ? [parsedField["currency"]] : DEFAULT_CURRENCIES;

  // @cast-boundary serialized-field is the dehydrated r.field.X() output =
  // a FieldDefinition; fieldToZod reads only its type-specific keys (the
  // extra fieldAccess/retention/label keys are ignored).
  return fieldToZod(fieldDef as unknown as FieldDefinition, currencies);
}
