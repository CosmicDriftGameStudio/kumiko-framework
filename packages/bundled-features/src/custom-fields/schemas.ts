import * as z from "zod";
import { SUPPORTED_FIELD_TYPES } from "./web/constants.ts";

export const fieldTypeSchema = z.enum(SUPPORTED_FIELD_TYPES);

// Per-field access-control. When set, `set/clear-custom-field` handlers
// require the calling user to hold at least one of the listed roles —
// in addition to the handler-level RBAC. Absent or empty `write` means
// the handler-level RBAC is the only gate.
//
// `read` is reserved for the postQuery-flatten pipeline and is not
// currently enforced.
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
  // `retention`: per-field expiry. The retention-cron strips
  // values whose host-row `modified_at` is older than `keepFor`. Strategy
  // `delete` removes the key from the customFields jsonb; `anonymize`
  // sets it to `null` (key stays, value gone — preserves the schema
  // shape for downstream consumers).
  retention: z
    .object({
      keepFor: z
        .string()
        .regex(/^\d+[hdwmy]$/, "keepFor must match /^\\d+[hdwmy]$/ (e.g. '30d', '10y')"),
      strategy: z.enum(["delete", "anonymize"]),
    })
    .optional(),
};

const rejectSensitive = [
  (v: Record<string, unknown>) => !("sensitive" in v),
  "custom fields don't support PII — `sensitive` was removed (#972). Model personal data as a schema entity field with a pii/userOwned/tenantOwned annotation instead.",
] as const;

const serializedFieldSchema = z
  .looseObject({ type: fieldTypeSchema, ...serializedFieldBaseShape })
  .refine((v) => typeof v["type"] === "string", "serializedField must have a string `type`")
  .refine(...rejectSensitive);

// Update may omit `type`: it is immutable, so the handler takes it from the stored definition.
const updateSerializedFieldSchema = z
  .looseObject({ type: fieldTypeSchema.optional(), ...serializedFieldBaseShape })
  .refine(...rejectSensitive);

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
