import { crossTenantOverrideDenied, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { APP_INSTANCE_STREAM_TYPE } from "@cosmicdrift/kumiko-framework/event-store";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-types/identifiers";
import { type AuditScope, AuditScopes } from "../constants.js";

export type AuditScopeFilter = { readonly tenantId: string; readonly aggregateType?: string };

// The system tenant also holds personal streams of other features (session
// revocations, exports, ...); only app-instance streams are released.
export function resolveAuditScopeFilter(
  user: SessionUser,
  scope: AuditScope | undefined,
): AuditScopeFilter {
  if (scope !== AuditScopes.system) return { tenantId: user.tenantId };
  const denied = crossTenantOverrideDenied(
    user,
    SYSTEM_TENANT_ID,
    "audit.errors.systemScopeRequiresSystemAdmin",
  );
  if (denied) throw denied;
  return { tenantId: SYSTEM_TENANT_ID, aggregateType: APP_INSTANCE_STREAM_TYPE };
}
