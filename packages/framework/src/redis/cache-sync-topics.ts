import type { TenantId } from "../engine/types/identifiers.js";

export const CACHE_SYNC_TOPICS = {
  tenantConfig: "tenant-config",
  tierAssignment: "tier-assignment",
} as const;

export type TenantConfigSyncMessage =
  | { readonly tenantId: TenantId; readonly key?: string }
  | { readonly scope: "all"; readonly key?: string };

export type TierAssignmentSyncMessage = { readonly tenantId: TenantId };

function hasOptionalStringKey(value: object): boolean {
  return !("key" in value) || value.key === undefined || typeof value.key === "string";
}

export function isTenantConfigSyncMessage(value: unknown): value is TenantConfigSyncMessage {
  if (typeof value !== "object" || value === null) return false;
  if (!hasOptionalStringKey(value)) return false;
  if ("scope" in value) return value.scope === "all";
  return "tenantId" in value && typeof value.tenantId === "string";
}

export function isTierAssignmentSyncMessage(value: unknown): value is TierAssignmentSyncMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "tenantId" in value &&
    typeof value.tenantId === "string"
  );
}
