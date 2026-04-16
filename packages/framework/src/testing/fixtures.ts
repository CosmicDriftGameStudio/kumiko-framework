import type { SessionUser } from "../engine/types";

export const TestUsers = {
  admin: { id: 1, tenantId: "00000000-0000-4000-8000-000000000001", roles: ["Admin"] },
  systemAdmin: { id: 1, tenantId: "00000000-0000-4000-8000-000000000001", roles: ["SystemAdmin"] },
  user: { id: 2, tenantId: "00000000-0000-4000-8000-000000000001", roles: ["User"] },
  driver: { id: 3, tenantId: "00000000-0000-4000-8000-000000000001", roles: ["Driver"] },
  otherTenant: { id: 10, tenantId: "00000000-0000-4000-8000-000000000002", roles: ["Admin"] },
} as const satisfies Record<string, SessionUser>;

export function createTestUser(overrides?: Partial<SessionUser>): SessionUser {
  return { ...TestUsers.admin, ...overrides };
}
