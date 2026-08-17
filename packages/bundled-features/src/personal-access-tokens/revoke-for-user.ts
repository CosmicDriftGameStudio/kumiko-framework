import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "temporal-polyfill";
import { apiTokenTable } from "./schema/api-token";

// Cross-tenant revoke: password-change and MFA-enable/disable are account-
// level security events, not scoped to one tenant. Mirrors sessions'
// sessionMassRevoker (session-callbacks.ts) which passes the boot-time
// DbConnection directly — not ctx.db, which would be tenant-scoped in a hook.
export async function revokeAllPatTokensForUser(db: DbRunner, userId: string): Promise<number> {
  const updated = await updateMany<{ id: string }>(
    db,
    apiTokenTable,
    { revokedAt: Temporal.Now.instant() },
    { userId, revokedAt: null },
  );
  return updated.length;
}
