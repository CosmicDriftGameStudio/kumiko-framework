import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";

// Tenant ids left over when the caller excludes some via ne/notIn; undefined for other operator forms.
export function tenantIdsAfterExclusion(
  requested: unknown,
  allowed: readonly unknown[],
): readonly unknown[] | undefined {
  if (!isPlainObject(requested)) return undefined;
  if ("ne" in requested) return allowed.filter((t) => t !== requested["ne"]);
  if (Array.isArray(requested["notIn"])) {
    const excluded: readonly unknown[] = requested["notIn"];
    return allowed.filter((t) => !excluded.includes(t));
  }
  return undefined;
}

// Tenant ids a where.tenantId filter asks for; undefined for operator forms
// that cannot narrow to a tenant list (ne, like, ...).
export function requestedTenantIds(requested: unknown): readonly unknown[] | undefined {
  if (Array.isArray(requested)) return requested;
  if (!isPlainObject(requested)) return [requested];
  if (Array.isArray(requested["in"])) return requested["in"];
  if ("eq" in requested) return [requested["eq"]];
  return undefined;
}

export function isForeignTenantId(tenantIdValue: unknown): boolean {
  return tenantIdValue !== undefined && tenantIdValue !== SYSTEM_TENANT_ID;
}
