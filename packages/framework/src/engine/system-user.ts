import type { SessionUser } from "./types";
import { SYSTEM_USER_ID, type TenantId } from "./types/identifiers";

export { SYSTEM_USER_ID };

export const SYSTEM_ROLE = "system" as const;

// extraRoles: hasAccess has no system bypass — handlers gate on
// explicit roles. Callers that must reach handlers gated e.g. on
// SystemAdmin (dispatchSystemWrite on entry:"signature" routes or the
// `wire` hook → billing-foundation process-event) pass the role here
// additionally; createdBy stays SYSTEM_USER_ID, the audit trail still shows System.
export function createSystemUser(
  tenantId: TenantId,
  extraRoles: readonly string[] = [],
): SessionUser {
  return {
    id: SYSTEM_USER_ID,
    tenantId,
    roles: [SYSTEM_ROLE, ...extraRoles],
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
