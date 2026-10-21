import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for deriving custom-field definition aggregate IDs.
// Generated once; changing it would re-key every existing fieldDefinition stream,
// breaking event replay and definition history. Drift is pinned in
// __tests__/drift.test.ts.
const FIELD_DEFINITION_NAMESPACE = "f1d3b2c7-4e5a-4b9c-8d1f-2a3b4c5d6e7f";

/**
 * Deterministic aggregate ID for a fieldDefinition aggregate from the tuple
 * (tenantId, entityName, fieldKey). Exactly one aggregate exists per
 * (Tenant|System, Entity, FieldKey).
 *
 * **Scope semantics:**
 *   - System scope: `tenantId = SYSTEM_TENANT_ID` → the fieldDefinition applies
 *     to all tenants (vendor-defined).
 *   - Tenant scope: `tenantId = <tenant-uuid>` → each tenant has its own
 *     fieldDefinition.
 *
 * **Conflict rule** (enforced in the write handler, NOT via a DB constraint):
 *   Only ONE definition may exist per (entityName, fieldKey)—system or tenant,
 *   but not both. If system defines `customer.internalNumber`, a tenant cannot
 *   define its own `customer.internalNumber` (422 `fieldKey_conflict`). This
 *   prevents ambiguity when resolving the field during reads.
 */
// @wrapper-known uuid-domain
export function fieldDefinitionAggregateId(
  tenantId: string,
  entityName: string,
  fieldKey: string,
): string {
  return uuidv5(`${tenantId}|${entityName}|${fieldKey}`, FIELD_DEFINITION_NAMESPACE);
}
