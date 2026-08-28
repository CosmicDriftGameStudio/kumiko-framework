import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { acquireNamespacedAdvisoryLock } from "@cosmicdrift/kumiko-framework/db";
import { ConflictError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { TenantErrors } from "./constants";
import { tenantMembershipsTable } from "./membership-table";

// Serializes last-TenantAdmin demotion/removal checks per tenant inside the write TX
// (dispatcher batch wraps handlers in transaction — xact lock holds through update).
export const LAST_TENANT_ADMIN_LOCK_NAMESPACE = 0x7461646d; // 'tadm'

type TenantDb = Parameters<typeof acquireNamespacedAdvisoryLock>[0];

/** Refuse demoting/removing the last TenantAdmin for `tenantId`. */
export async function assertNotLastTenantAdmin(
  db: TenantDb,
  tenantId: string,
  userId: string,
): Promise<ReturnType<typeof writeFailure> | undefined> {
  await acquireNamespacedAdvisoryLock(db, LAST_TENANT_ADMIN_LOCK_NAMESPACE, tenantId);
  const allMemberships = await selectMany(db, tenantMembershipsTable, { tenantId });
  const adminCount = allMemberships.filter((m) =>
    parseRoles(m["roles"]).includes("TenantAdmin"),
  ).length;
  if (adminCount <= 1) {
    return writeFailure(
      new ConflictError({
        message: "cannot demote the last tenant admin",
        i18nKey: "tenant.errors.cannotDemoteLastTenantAdmin",
        details: {
          reason: TenantErrors.lastTenantAdmin,
          userId,
          tenantId,
        },
      }),
    );
  }
  return undefined;
}
