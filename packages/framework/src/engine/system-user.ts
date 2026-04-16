import type { SessionUser } from "./types";
import type { TenantId } from "@kumiko/framework/engine";

export const SYSTEM_USER_ID = 0;
export const SYSTEM_ROLE = "system" as const;

export function createSystemUser(tenantId: TenantId): SessionUser {
  return {
    id: SYSTEM_USER_ID,
    tenantId,
    roles: [SYSTEM_ROLE],
  };
}
