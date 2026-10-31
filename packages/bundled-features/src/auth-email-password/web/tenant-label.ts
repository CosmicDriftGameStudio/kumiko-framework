import type { TenantSummary } from "./auth-client.ts";

// Label priority: app-provided resolver > server-provided name/key from
// /auth/tenants > UUID prefix. The prefix is only a last resort — it is
// indistinguishable for seeded tenants (00000000-…).
export function tenantLabel(
  tenants: readonly TenantSummary[],
  tenantId: string,
  tenantName: ((tenantId: string) => string) | undefined,
): string {
  if (tenantName !== undefined) return tenantName(tenantId);
  const membership = tenants.find((m) => m.tenantId === tenantId);
  // || instead of ??: an empty name/key string must not be used as a label.
  return membership?.name || membership?.key || tenantId.slice(0, 8);
}
