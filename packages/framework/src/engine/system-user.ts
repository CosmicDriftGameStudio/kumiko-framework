import type { SessionUser } from "./types";

export const SYSTEM_USER_ID = 0;
export const SYSTEM_ROLE = "system" as const;

export function createSystemUser(tenantId: number): SessionUser {
  return {
    id: SYSTEM_USER_ID,
    tenantId,
    roles: [SYSTEM_ROLE],
  };
}
