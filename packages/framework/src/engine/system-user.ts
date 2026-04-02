import type { PipelineUser } from "./types";

export const SYSTEM_USER_ID = 0;
export const SYSTEM_ROLE = "system" as const;

export function createSystemUser(tenantId: number): PipelineUser {
  return {
    id: SYSTEM_USER_ID,
    tenantId,
    roles: [SYSTEM_ROLE],
  };
}
