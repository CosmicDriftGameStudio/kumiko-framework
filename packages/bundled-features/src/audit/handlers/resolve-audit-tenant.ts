import { mayOverrideTenant, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, FrameworkReasons } from "@cosmicdrift/kumiko-framework/errors";
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
  if (!mayOverrideTenant(user)) {
    throw new AccessDeniedError({
      i18nKey: "audit.errors.systemScopeRequiresSystemAdmin",
      details: { reason: FrameworkReasons.tenantOverrideRequiresSystemAdmin },
    });
  }
  return { tenantId: SYSTEM_TENANT_ID, aggregateType: APP_INSTANCE_STREAM_TYPE };
}
