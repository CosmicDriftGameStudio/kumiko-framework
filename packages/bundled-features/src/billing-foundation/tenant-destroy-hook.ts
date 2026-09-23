import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { declareEscapeHatch, type TenantDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { archiveStream } from "@cosmicdrift/kumiko-framework/event-store";
import { resolveProfileForTenant } from "../compliance-profiles";
import { paymentAggregateId, subscriptionAggregateId } from "./aggregate-id";
import { PAYMENT_AGGREGATE_TYPE, SUBSCRIPTION_AGGREGATE_TYPE } from "./events";
import { paymentsProjectionTable, subscriptionsProjectionTable } from "./projection";

// providerCustomerId/providerSubscriptionId are `personal: "tenant"` on the
// entity (envelope-encrypted with the tenant subject key, see entities.ts) —
// eraseSubjectKeys crypto-shreds them for tenants that hard-delete. HGB
// can not: it needs the accounting facts (status/tier/period) to survive, so
// it redacts the projection row directly instead of relying on key erasure.
const REDACTED_PII_VALUE = "[erased]";

// Compliance-profile lookup and event-stream archive both sit outside TenantDb's own methods — need the escape hatch.
export const SUBSCRIPTION_TENANT_DESTROY_ARCHIVE_REASON =
  "tenant-destroy looks up the compliance profile and archives the subscription event-stream before the projection row is redacted/deleted";
export const PAYMENT_TENANT_DESTROY_ARCHIVE_REASON =
  "tenant-destroy looks up the compliance profile and archives the payment event-stream before the projection rows are redacted/deleted";

/** Tenant-destroy hook for billing PII (#800). HGB retains the accounting
 *  row but redacts the two provider-subject PII fields; other profiles
 *  hard-delete the row. Either way the subscription stream is archived so a
 *  future projection rebuild can't resurrect what was erased. */
export async function subscriptionTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  declareEscapeHatch({ reason: SUBSCRIPTION_TENANT_DESTROY_ARCHIVE_REASON });
  const { profile } = await resolveProfileForTenant({
    db: ctx.db.unsafeRaw(SUBSCRIPTION_TENANT_DESTROY_ARCHIVE_REASON),
    tenantId: ctx.tenantId,
  });
  const aggregateId = subscriptionAggregateId(ctx.tenantId);
  if (profile.key === "de-hr-dsgvo-hgb") {
    await ctx.db.updateMany(
      subscriptionsProjectionTable as EntityTableMeta,
      { providerCustomerId: REDACTED_PII_VALUE, providerSubscriptionId: REDACTED_PII_VALUE },
      { id: aggregateId },
    );
  } else {
    await ctx.db.deleteMany(subscriptionsProjectionTable as EntityTableMeta, { id: aggregateId });
  }
  await archiveStream(ctx.db.unsafeRaw(SUBSCRIPTION_TENANT_DESTROY_ARCHIVE_REASON), {
    tenantId: ctx.tenantId,
    aggregateId,
    aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
    archivedBy: "tenant-lifecycle:destroy",
    reason: "tenant_destroy",
  });
}

/** Tenant-destroy hook for payment PII (#800). Unlike subscriptionTenantDestroyHook
 *  (one row per tenant, targeted by `id`), a tenant can have many payment
 *  rows — the predicate here is `tenantId`, not `id`. The payment-stream
 *  itself is still one stream per tenant (paymentAggregateId), so
 *  archiveStream targets that single aggregateId as usual. */
export async function paymentTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  declareEscapeHatch({ reason: PAYMENT_TENANT_DESTROY_ARCHIVE_REASON });
  const { profile } = await resolveProfileForTenant({
    db: ctx.db.unsafeRaw(PAYMENT_TENANT_DESTROY_ARCHIVE_REASON),
    tenantId: ctx.tenantId,
  });
  const aggregateId = paymentAggregateId(ctx.tenantId);
  if (profile.key === "de-hr-dsgvo-hgb") {
    await ctx.db.updateMany(
      paymentsProjectionTable as EntityTableMeta,
      { providerCustomerId: REDACTED_PII_VALUE },
      { tenantId: ctx.tenantId },
    );
  } else {
    await ctx.db.deleteMany(paymentsProjectionTable as EntityTableMeta, {
      tenantId: ctx.tenantId,
    });
  }
  await archiveStream(ctx.db.unsafeRaw(PAYMENT_TENANT_DESTROY_ARCHIVE_REASON), {
    tenantId: ctx.tenantId,
    aggregateId,
    aggregateType: PAYMENT_AGGREGATE_TYPE,
    archivedBy: "tenant-lifecycle:destroy",
    reason: "tenant_destroy",
  });
}
