import { v5 as uuidv5 } from "uuid";

// Fixed UUID-namespace für custom-field-definition aggregate-id-Ableitung.
// Generiert einmalig (2026-05-22), in Stein gemeißelt: ein Wechsel würde
// jeden existing fieldDefinition-Stream re-keyen → kaputter event-replay,
// kaputte definition-history. Drift-Pin in __tests__/drift.test.ts.
const FIELD_DEFINITION_NAMESPACE = "f1d3b2c7-4e5a-4b9c-8d1f-2a3b4c5d6e7f";

/**
 * Deterministic aggregate-id für ein fieldDefinition-Aggregate aus dem
 * Tripel (tenantId, entityName, fieldKey). Pro (Tenant|System, Entity,
 * FieldKey) existiert genau ein Aggregate.
 *
 * **Scope-Semantik:**
 *   - System-Scope: `tenantId = SYSTEM_TENANT_ID` → die fieldDefinition
 *     gilt für alle Tenants (vendor-defined).
 *   - Tenant-Scope: `tenantId = <tenant-uuid>` → pro Tenant eigene
 *     fieldDefinition.
 *
 * **Conflict-Rule** (durchgesetzt im write-handler, NICHT via DB-constraint):
 *   Pro (entityName, fieldKey) darf nur EINE Definition existieren — entweder
 *   system oder tenant, nicht beide. Wenn system `customer.internalNumber`
 *   definiert, kann Tenant kein eigenes `customer.internalNumber` mehr
 *   definieren (422 `fieldKey_conflict`). Verhindert Resolution-Ambiguität
 *   beim Read.
 */
// @wrapper-known uuid-domain
export function fieldDefinitionAggregateId(
  tenantId: string,
  entityName: string,
  fieldKey: string,
): string {
  return uuidv5(`${tenantId}|${entityName}|${fieldKey}`, FIELD_DEFINITION_NAMESPACE);
}
