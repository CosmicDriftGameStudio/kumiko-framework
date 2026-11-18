import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { SUPPORTED_EMBEDDED_SUB_TYPES, SUPPORTED_FIELD_TYPES } from "./web/constants.ts";

export const fieldTypeSchema = z.enum(SUPPORTED_FIELD_TYPES);

// Per-field access-control. When set, `set/clear-custom-field` handlers
// require the calling user to hold at least one of the listed roles —
// in addition to the handler-level RBAC. Absent or empty `write` means
// the handler-level RBAC is the only gate.
//
// `read` restricts which roles see the value in query results; read-restricted fields are never put into the search index.
export const customFieldAccessSchema = z
  .object({
    read: z.array(z.string()).optional(),
    write: z.array(z.string()).optional(),
  })
  .optional();
export type CustomFieldAccess = z.infer<typeof customFieldAccessSchema>;

// Serialized-field JSONB: the value stored in the `serializedField` column.
// In v1, it is not strictly typed per field type because the base-field
// builder schemas are not yet exposed. This schema only guarantees the
// overall structure.
//
// Schema shape (example inputs for the different field types):
//
//   text:     { type: "text", required: true, maxLength: 50 }
//   number:   { type: "number", required: false, min: 0, max: 100 }
//   boolean:  { type: "boolean", required: false }
//   date:     { type: "date", required: false }
//   enum:     { type: "enum", required: true, values: ["bronze", "silver", "gold"] }
//   money:    { type: "money", required: false, currency: "EUR" }
//   embedded: { type: "embedded", required: false, schema: { ... } }
//
// `fieldAccess` is the structured key recognised by the handlers.
// Everything else remains loose pending per-type discriminated unions —
// EXCEPT `sensitive`, which is explicitly rejected below: custom fields
// carry supplemental business data only, and PII support was removed.
const serializedFieldBaseShape = {
  fieldAccess: customFieldAccessSchema,
};

const rejectSensitive = [
  (v: Record<string, unknown>) => !("sensitive" in v),
  "custom fields don't support PII — `sensitive` was removed (#972). Model personal data as a schema entity field with a pii/userOwned/tenantOwned annotation instead.",
] as const;

const rejectRetention = [
  (v: Record<string, unknown>) => !("retention" in v),
  "per-field custom-field retention was removed — it never ran. Set retention on the host entity (data-retention) instead.",
] as const;

const EMBEDDED_SUB_TYPES_SET: ReadonlySet<string> = new Set(SUPPORTED_EMBEDDED_SUB_TYPES);

function isCheckedEmbeddedSubField(sub: unknown, definitionCurrency: unknown): boolean {
  if (!isPlainObject(sub) || typeof sub["type"] !== "string") return false;
  if (!EMBEDDED_SUB_TYPES_SET.has(sub["type"])) return false;
  if (sub["type"] === "enum") return Array.isArray(sub["values"]) && sub["values"].length > 0;
  // An embedded amount is a bare integer, so the definition is the only place its currency lives.
  if (sub["type"] === "money") return typeof definitionCurrency === "string";
  return true;
}

// Each sub-field must be one set-custom-field can check, otherwise its values would be stored unchecked.
const rejectUncheckedEmbeddedSubFields = [
  (v: Record<string, unknown>) => {
    if (v["type"] !== undefined && v["type"] !== "embedded") return true;
    const schema = v["schema"];
    if (schema === undefined && v["type"] === undefined) return true;
    return (
      isPlainObject(schema) &&
      Object.values(schema).every((sub) => isCheckedEmbeddedSubField(sub, v["currency"]))
    );
  },
  `embedded sub-fields must be one of ${SUPPORTED_EMBEDDED_SUB_TYPES.join(", ")}; enum needs values, money needs the definition's currency`,
] as const;

const serializedFieldSchema = z
  .looseObject({ type: fieldTypeSchema, ...serializedFieldBaseShape })
  .refine((v) => typeof v["type"] === "string", "serializedField must have a string `type`")
  .refine(...rejectSensitive)
  .refine(...rejectRetention)
  .refine(...rejectUncheckedEmbeddedSubFields);

// Update may omit `type`: it is immutable, so the handler takes it from the stored definition.
const updateSerializedFieldSchema = z
  .looseObject({ type: fieldTypeSchema.optional(), ...serializedFieldBaseShape })
  .refine(...rejectSensitive)
  .refine(...rejectRetention)
  .refine(...rejectUncheckedEmbeddedSubFields);

// i18n labels — `{ de: "...", en: "...", ... }`. At least one entry.
const labelSchema = z.record(z.string().min(2).max(8), z.string().min(1));

// Payload for the `define-tenant-field` and `define-system-field` write handlers.
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

// Payload for `update-tenant-field`: full replacement like define (the edit
// screen sends the complete new state; entityName+fieldKey are the identity),
// except that `serializedField.type` may be omitted. type is immutable; a
// differing value is refused in the handler.
export const updateFieldPayloadSchema = defineFieldPayloadSchema.extend({
  serializedField: updateSerializedFieldSchema,
});
export type UpdateFieldPayload = z.infer<typeof updateFieldPayloadSchema>;

// Payload for `delete-tenant-field` / `delete-system-field`.
export const deleteFieldPayloadSchema = z.object({
  entityName: z.string().min(1).max(64),
  fieldKey: z.string().min(1).max(64),
});
export type DeleteFieldPayload = z.infer<typeof deleteFieldPayloadSchema>;
