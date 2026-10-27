import type { DispatcherError } from "@cosmicdrift/kumiko-renderer/headless";

export const TENANT_OVERRIDE_DENIED_REASON = "tenant_override_requires_system_admin";

export function isTenantOverrideDeniedError(error: DispatcherError): boolean {
  return error.details?.["reason"] === TENANT_OVERRIDE_DENIED_REASON;
}
