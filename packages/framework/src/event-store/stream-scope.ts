import {
  runInRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "../db/row-level-security-scope.ts";
import type { TenantId } from "../engine/types/index.ts";

// A stream belongs to exactly one tenant; its rows are only writable and reliably readable in
// that tenant's scope, which differs from the caller's for systemStream entities and ctx.tenants.writeTarget.
export function inEventStreamScope<T>(
  streamTenantId: TenantId,
  work: () => Promise<T>,
): Promise<T> {
  return runInRowLevelSecurityScope(tenantRowLevelSecurityScope(streamTenantId), work);
}
