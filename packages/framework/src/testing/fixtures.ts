import type { SessionUser, TenantId } from "../engine/types";

// Zero-padded UUIDs used across the test suite. `testTenantId(1)` /
// `testUserId(1)` read cleaner in assertions than the full UUID literals,
// and keep all tests on a single shape — if the UUID layout ever changes,
// it changes here.
export function testTenantId(n: number): TenantId {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

// Distinct prefix from tenantId so debug output visibly differentiates the
// two when a user-id accidentally lands in a tenant-id slot.
export function testUserId(n: number): string {
  return `11111111-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

export const TestUsers = {
  admin: { id: testUserId(1), tenantId: testTenantId(1), roles: ["Admin"] },
  systemAdmin: { id: testUserId(1), tenantId: testTenantId(1), roles: ["SystemAdmin"] },
  user: { id: testUserId(2), tenantId: testTenantId(1), roles: ["User"] },
  driver: { id: testUserId(3), tenantId: testTenantId(1), roles: ["Driver"] },
  otherTenant: { id: testUserId(10), tenantId: testTenantId(2), roles: ["Admin"] },
} as const satisfies Record<string, SessionUser>;

// Accept numeric shortcuts for legacy call sites — stringify to a UUID so the
// SessionUser type stays aligned. `createTestUser({ id: 42 })` gives you
// `testUserId(42)`. Explicit strings pass through untouched.
export function createTestUser(
  overrides?: Partial<Omit<SessionUser, "id">> & { id?: string | number },
): SessionUser {
  const normalizedId =
    typeof overrides?.id === "number"
      ? testUserId(overrides.id)
      : (overrides?.id ?? TestUsers.admin.id);
  const { id: _id, ...rest } = overrides ?? {};
  return { ...TestUsers.admin, ...rest, id: normalizedId };
}
