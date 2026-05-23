import { z } from "zod";
import { SUPPORTED_FIELD_TYPES } from "./constants";

// Field-Type-Validator — pinnt valid type-Werte für fieldDefinition.
const fieldTypeSchema = z.enum(SUPPORTED_FIELD_TYPES);

// Per-field access-control. When set, `set/clear-custom-field` handlers
// require the calling user to hold at least one of the listed roles —
// in addition to the handler-level RBAC. Absent or empty `write` means
// the handler-level RBAC is the only gate.
//
// `read` is reserved for the postQuery-flatten pipeline (T1.5c+); not
// enforced in T1.5b.
export const customFieldAccessSchema = z
  .object({
    read: z.array(z.string()).optional(),
    write: z.array(z.string()).optional(),
  })
  .optional();
export type CustomFieldAccess = z.infer<typeof customFieldAccessSchema>;

// Serialized-field-jsonb — was als `serializedField`-Spalte gespeichert wird.
// In v1 noch nicht strict-typed pro field-type (das kommt in B2 wenn die
// Stammfeld-Builder-Schemas exposed sind). Hier nur die Struktur-Garantie.
//
// Schema-shape (Beispiel-Inputs für die unterschiedlichen Field-Types):
//
//   text:     { type: "text", required: true, maxLength: 50 }
//   number:   { type: "number", required: false, min: 0, max: 100 }
//   boolean:  { type: "boolean", required: false }
//   date:     { type: "date", required: false }
//   enum:     { type: "enum", required: true, values: ["bronze", "silver", "gold"] }
//   money:    { type: "money", required: false, currency: "EUR" }
//   embedded: { type: "embedded", required: false, schema: { ... } }
//
// `fieldAccess` (T1.5b) and `sensitive` (T1.5c) are the structured keys
// recognised by the handlers / user-data-rights wiring. Everything else
// stays loose pending B2's per-type discriminated-union.
const serializedFieldSchema = z
  .looseObject({
    type: fieldTypeSchema,
    fieldAccess: customFieldAccessSchema,
    // `sensitive: true` marks the field as PII — the user-data-rights
    // wiring (wireCustomFieldsUserDataRightsFor) removes its value from
    // the host row's customFields jsonb on user-forget when the strategy
    // is "anonymize". Non-sensitive fields are untouched.
    sensitive: z.boolean().optional(),
  })
  .refine((v) => typeof v["type"] === "string", "serializedField must have a string `type`");

// i18n-labels — `{ de: "...", en: "...", ... }`. Mindestens ein Eintrag.
const labelSchema = z.record(z.string().min(2).max(8), z.string().min(1));

// Payload für `define-tenant-field` und `define-system-field` write-handler.
export const defineFieldPayloadSchema = z.object({
  entityName: z.string().min(1).max(64),
  fieldKey: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_-]*$/,
      "fieldKey must start with a letter, only letters/digits/_/- allowed",
    ),
  serializedField: serializedFieldSchema,
  required: z.boolean().default(false),
  searchable: z.boolean().default(false),
  displayOrder: z.number().int().min(0).default(0),
  label: labelSchema.optional(),
});
export type DefineFieldPayload = z.infer<typeof defineFieldPayloadSchema>;

// Payload für `delete-tenant-field` / `delete-system-field`.
export const deleteFieldPayloadSchema = z.object({
  entityName: z.string().min(1).max(64),
  fieldKey: z.string().min(1).max(64),
});
export type DeleteFieldPayload = z.infer<typeof deleteFieldPayloadSchema>;
