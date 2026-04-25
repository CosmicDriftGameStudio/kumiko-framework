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

// Anonymous = unauthenticated caller on a public endpoint. id is a stable
// literal (not a UUID) so audit-trails and event-store rows stay readable —
// `actor: "anonymous"` is more useful than a random UUID-bucket. Reserved
// like SYSTEM_ROLE: the boot-validator rejects apps that declare these as
// custom roles.
export const ANONYMOUS_USER_ID = "anonymous";
export const ANONYMOUS_ROLE = "anonymous" as const;

export function createAnonymousUser(tenantId: TenantId): SessionUser {
  return {
    id: ANONYMOUS_USER_ID,
    tenantId,
    roles: [ANONYMOUS_ROLE],
  };
}
