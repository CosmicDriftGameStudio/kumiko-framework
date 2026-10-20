import { mayOverrideTenant, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, FrameworkReasons } from "@cosmicdrift/kumiko-framework/errors";
import { APP_INSTANCE_STREAM_TYPE } from "@cosmicdrift/kumiko-framework/event-store";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-types/identifiers";
import { type AuditScope, AuditScopes } from "../web/constants.ts";

export type AuditScopeFilter = { readonly tenantId: string; readonly aggregateType?: string };

function denySystemAdminOnlyRead(): never {
  throw new AccessDeniedError({
    i18nKey: "audit.errors.systemScopeRequiresSystemAdmin",
    details: { reason: FrameworkReasons.tenantOverrideRequiresSystemAdmin },
  });
}

// The system tenant also holds personal streams of other features (session
// revocations, exports, ...); only app-instance streams are released.
export function resolveAuditScopeFilter(
  user: SessionUser,
  scope: AuditScope | undefined,
): AuditScopeFilter {
  if (scope !== AuditScopes.system) return { tenantId: user.tenantId };
  if (!mayOverrideTenant(user)) denySystemAdminOnlyRead();
  return { tenantId: SYSTEM_TENANT_ID, aggregateType: APP_INSTANCE_STREAM_TYPE };
}

export function assertMayReadAllTenants(user: SessionUser): void {
  if (!mayOverrideTenant(user)) denySystemAdminOnlyRead();
}

// The where condition for reads across tenants. The system tenant is always excluded: it holds
// personal streams of other features, and a where object cannot express "only app-instance
// streams of that one tenant" next to "every other tenant".
export function allTenantsCondition(requestedTenantIds: readonly string[] | undefined): unknown {
  if (requestedTenantIds === undefined) return { ne: SYSTEM_TENANT_ID };
  return { in: requestedTenantIds.filter((id) => id !== SYSTEM_TENANT_ID) };
}
