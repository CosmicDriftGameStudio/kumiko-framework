import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { isSystemTenant } from "@cosmicdrift/kumiko-framework/engine";
import type { StoredEvent } from "@cosmicdrift/kumiko-framework/event-store";
import {
  clearCustomFieldKey,
  removeCustomFieldKeyForTenant,
  removeCustomFieldKeyFromAllTenants,
  setCustomFieldValue,
} from "../db/queries/projection.ts";
import {
  customFieldClearedSchema,
  customFieldSetSchema,
  type FieldDefinitionDeletedPayload,
} from "../events.ts";

export async function applyCustomFieldSet(
  event: StoredEvent,
  tx: DbRunner,
  tableName: string,
): Promise<void> {
  const payload = customFieldSetSchema.parse(event.payload);
  // skip: set-custom-field rejects a missing value, so only a hand-appended event lacks one; binding undefined would break the jsonb write
  if (payload.value === undefined) return;
  await setCustomFieldValue(
    tx,
    tableName,
    payload.fieldKey,
    payload.value,
    event.aggregateId,
    event.tenantId,
  );
}

export async function applyCustomFieldCleared(
  event: StoredEvent,
  tx: DbRunner,
  tableName: string,
): Promise<void> {
  const payload = customFieldClearedSchema.parse(event.payload);
  await clearCustomFieldKey(tx, tableName, payload.fieldKey, event.aggregateId, event.tenantId);
}

export async function applyFieldDefinitionDeleted(
  payload: FieldDefinitionDeletedPayload,
  tx: DbRunner,
  tableName: string,
): Promise<void> {
  // Scope cleanup to the deleted definition's owning tenant. System-scope
  // definitions apply to every tenant → cascade across all rows; tenant-
  // scope deletions must only touch that tenant's rows, else deleting one
  // tenant's field strips the same kebab key from every tenant (data loss).
  if (isSystemTenant(payload.tenantId)) {
    await removeCustomFieldKeyFromAllTenants(tx, tableName, payload.fieldKey);
  } else {
    await removeCustomFieldKeyForTenant(tx, tableName, payload.fieldKey, payload.tenantId);
  }
}
