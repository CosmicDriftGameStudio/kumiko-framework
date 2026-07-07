import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { userSessionTable } from "../../sessions";

/** Revoke all live sessions scoped to a tenant (destruction-request gate). */
export async function revokeTenantSessions(db: DbRunner, tenantId: TenantId): Promise<number> {
  const updated = await updateMany(
    db,
    userSessionTable,
    { revokedAt: getTemporal().Now.instant() },
    { tenantId, revokedAt: null },
  );
  return updated.length;
}
