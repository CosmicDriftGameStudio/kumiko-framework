import { asRawClient, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { Temporal } from "temporal-polyfill";
import { apiTokenTable } from "./schema/api-token";

// Cross-tenant revoke: password-change and MFA-enable/disable are account-
// level security events, not scoped to one tenant. Mirrors sessions'
// revoke-all-for-user.write.ts (which passes ctx.db.raw instead of the
// tenant-scoped ctx.db) — asRawClient additionally normalizes the
// DbConnection|TenantDb union a lifecycle hook's AppContext carries, unlike
// a write handler's guaranteed TenantDb.
export async function revokeAllPatTokensForUser(db: unknown, userId: string): Promise<number> {
  const updated = await updateMany<{ id: string }>(
    asRawClient(db),
    apiTokenTable,
    { revokedAt: Temporal.Now.instant() },
    { userId, revokedAt: null },
  );
  return updated.length;
}
