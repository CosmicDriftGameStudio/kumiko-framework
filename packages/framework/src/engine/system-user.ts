import type { SessionUser } from "./types";
import { SYSTEM_USER_ID, type TenantId } from "./types/identifiers";

export { SYSTEM_USER_ID };

export const SYSTEM_ROLE = "system" as const;

// extraRoles: hasAccess kennt keinen System-Bypass — Handler gaten auf
// explizite Rollen. Caller, die Handler mit z.B. SystemAdmin-Gate erreichen
// müssen (extraRoutes.dispatchSystemWrite → billing-foundation
// process-event), geben die Rolle hier zusätzlich mit; createdBy bleibt
// SYSTEM_USER_ID, der Audit-Trail zeigt weiterhin System.
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
