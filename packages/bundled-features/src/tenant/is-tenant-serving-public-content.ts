import type { TenantLifecycleStatus } from "./schema/tenant";

/** Whether a tenant still serves content to anonymous/public callers.
 *  `destroyRequested` is deliberately blocked too, not just `destroying`
 *  onward — secure by default: the tenant already asked to be removed, so
 *  its data should stop being publicly reachable immediately rather than
 *  during the grace period. */
export function isTenantServingPublicContent(row: {
  readonly isEnabled: boolean;
  readonly status: TenantLifecycleStatus;
}): boolean {
  return row.isEnabled && row.status === "active";
}
