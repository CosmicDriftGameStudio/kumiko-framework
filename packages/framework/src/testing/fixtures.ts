import type { SessionUser } from "../engine/types";

export const TestUsers = {
  admin: { id: 1, tenantId: 1, roles: ["Admin"] },
  systemAdmin: { id: 1, tenantId: 1, roles: ["SystemAdmin"] },
  user: { id: 2, tenantId: 1, roles: ["User"] },
  driver: { id: 3, tenantId: 1, roles: ["Driver"] },
  otherTenant: { id: 10, tenantId: 2, roles: ["Admin"] },
} as const satisfies Record<string, SessionUser>;

export function createTestUser(overrides?: Partial<SessionUser>): SessionUser {
  return { ...TestUsers.admin, ...overrides };
}
