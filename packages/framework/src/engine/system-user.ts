import type { TenantId } from "@kumiko/framework/engine";
import type { SessionUser } from "./types";

// Stringified so it round-trips through SessionUser.id (string UUID-shape).
// Not a real UUID — SYSTEM acts as an alias for "no human caller" and event-
// store createdBy is text, so the literal suffices.
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
export const SYSTEM_ROLE = "system" as const;

export function createSystemUser(tenantId: TenantId): SessionUser {
  return {
    id: SYSTEM_USER_ID,
    tenantId,
    roles: [SYSTEM_ROLE],
  };
}
