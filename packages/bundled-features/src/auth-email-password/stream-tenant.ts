// user-feature runs with r.systemScope() but events land on a concrete
// tenant stream. The row.version tracks whichever stream the user's last
// modification wrote to — and that tenant is NOT discoverable from the
// row alone.
//
// Strategy: prioritize lastActiveTenantId (most likely holds the latest
// event), fall through to the remaining memberships in insertion order,
// and let the caller try each one in sequence. The first stream whose
// version matches row.version wins; the rest are bypassed.
//
// This is pragmatic — the real fix is to scope user events to
// SYSTEM_TENANT_ID when the feature is r.systemScope(), which is a
// framework-level change tracked separately. Until then, "try each
// tenant the user belongs to" is robust against non-deterministic
// memberships-query ordering (tenant:query:memberships has no ORDER BY).

import type { TenantId } from "@kumiko/framework/engine";

export function orderTenantsByPreference(
  memberships: readonly { readonly tenantId: TenantId }[],
  lastActiveTenantId: string | null | undefined,
): TenantId[] {
  if (memberships.length === 0) return [];
  const ids = memberships.map((m) => m.tenantId);
  if (!lastActiveTenantId) return ids;
  // Move lastActiveTenantId to the front; preserve relative order of rest.
  const preferred = ids.find((id) => id === lastActiveTenantId);
  if (!preferred) return ids;
  const rest = ids.filter((id) => id !== preferred);
  return [preferred, ...rest];
}
