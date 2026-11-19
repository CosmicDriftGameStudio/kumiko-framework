import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for field-change-request aggregate-id derivation. Generated
// once (2026-11-17), frozen: changing it would re-key every existing request
// stream → broken replay. Drift-pinned in __tests__.
const FIELD_CHANGE_REQUEST_NAMESPACE = "3c1e8a52-7d94-4f0b-a6e2-9b5d1f04c7e8";

// One request row per (tenant, host record, field): a new request for the same
// field overwrites the requester's own open one instead of piling up.
export function fieldChangeRequestAggregateId(
  tenantId: string,
  entityType: string,
  entityId: string,
  fieldName: string,
): string {
  return uuidv5(
    `${tenantId}|${entityType}|${entityId}|${fieldName}`,
    FIELD_CHANGE_REQUEST_NAMESPACE,
  );
}
