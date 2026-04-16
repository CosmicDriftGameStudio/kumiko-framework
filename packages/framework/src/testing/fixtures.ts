import type { SessionUser, TenantId } from "../engine/types";

// Zero-padded tenant UUIDs used across the test suite. `testTenantId(1)` reads
// cleaner in assertions than the full UUID literal, and keeps all tests on a
// single shape — if the UUID layout ever changes, it changes here.
export function testTenantId(n: number): TenantId {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

export const TestUsers = {
  admin: { id: 1, tenantId: testTenantId(1), roles: ["Admin"] },
  systemAdmin: { id: 1, tenantId: testTenantId(1), roles: ["SystemAdmin"] },
  user: { id: 2, tenantId: testTenantId(1), roles: ["User"] },
  driver: { id: 3, tenantId: testTenantId(1), roles: ["Driver"] },
  otherTenant: { id: 10, tenantId: testTenantId(2), roles: ["Admin"] },
} as const satisfies Record<string, SessionUser>;

export function createTestUser(overrides?: Partial<SessionUser>): SessionUser {
  return { ...TestUsers.admin, ...overrides };
}
