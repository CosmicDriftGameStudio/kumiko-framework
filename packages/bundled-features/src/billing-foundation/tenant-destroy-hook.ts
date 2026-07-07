import { deleteMany, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resolveProfileForTenant } from "../compliance-profiles/resolve-for-tenant";
import { subscriptionAggregateId } from "./aggregate-id";
import { subscriptionsProjectionTable } from "./projection";

/** Tenant-destroy hook for billing PII (#800). HGB keeps ciphertext row
 *  (subject-keys stage erases tenant DEK); other profiles hard-delete. */
export async function subscriptionTenantDestroyHook(ctx: {
  readonly db: import("@cosmicdrift/kumiko-framework/db").DbRunner;
  readonly tenantId: TenantId;
}): Promise<void> {
  const { profile } = await resolveProfileForTenant({
    db: ctx.db,
    tenantId: ctx.tenantId,
  });
  if (profile.key === "de-hr-dsgvo-hgb") {
    // skip: HGB retention — row stays until crypto-shredded by subject-keys stage
    return;
  }
  await deleteMany(ctx.db, subscriptionsProjectionTable as EntityTableMeta, {
    id: subscriptionAggregateId(ctx.tenantId),
  });
}
