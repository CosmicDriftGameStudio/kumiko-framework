import type { EventUpcastFn } from "@cosmicdrift/kumiko-types/handlers";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";

// Domain events for custom-field values. customField.set and .cleared live
// on the host aggregate stream, alongside the host entity's own events.
//
// The event's aggregate type is the host entity name (for example, "property"),
// and its aggregate ID is the host entity row ID (for example, property-uuid).
// The custom-fields `host-values` projection resolves the host table from this
// aggregate type and skips types that are not wired.

export const customFieldSetSchema = z.object({
  fieldKey: z.string().min(1).max(64),
  // Every set carries its value (custom fields hold no PII) — replay
  // reproduces the projection fully. Stays optional at the type layer only
  // because z.unknown() is inherently optional; the apply side treats
  // `value === undefined` as an anomaly and warns.
  value: z.unknown().optional(),
});
export type CustomFieldSetPayload = z.infer<typeof customFieldSetSchema>;

export const customFieldClearedSchema = z.object({
  fieldKey: z.string().min(1).max(64),
});
export type CustomFieldClearedPayload = z.infer<typeof customFieldClearedSchema>;

// Owning tenant of the deleted definition: SYSTEM_TENANT_ID means the cleanup
// runs across all tenants, any other value only across that tenant.
export const fieldDefinitionDeletedSchema = z.object({
  entityName: z.string(),
  fieldKey: z.string(),
  tenantId: z.string().min(1),
});
export type FieldDefinitionDeletedPayload = z.infer<typeof fieldDefinitionDeletedSchema>;

export const FIELD_DEFINITION_DELETED_EVENT_VERSION = 2;

// v1 payloads predate the owning tenant in the payload; it lives only on the stored event row,
// which the upcast context exposes as ctx.tenantId.
export const addTenantIdToFieldDefinitionDeleted: EventUpcastFn = (payload, ctx) => {
  if (!isPlainObject(payload)) return payload;
  const existing = payload["tenantId"];
  if (typeof existing === "string" && existing.length > 0) return payload;
  return { ...payload, tenantId: ctx.tenantId };
};
