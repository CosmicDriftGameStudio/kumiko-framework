import { deleteMany, type EntityTableMeta, updateMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { archiveStream } from "@cosmicdrift/kumiko-framework/event-store";
import { resolveProfileForTenant } from "../compliance-profiles";
import { subscriptionAggregateId } from "./aggregate-id";
import { SUBSCRIPTION_AGGREGATE_TYPE } from "./events";
import { subscriptionsProjectionTable } from "./projection";

// No field-level encryption is wired up for `read_subscriptions` (see
// entities.ts) — a crypto-shredding retention strategy would need that built
// first (envelope-encrypt on write, decrypt on every read call site, backfill
// existing rows). Redaction achieves the same GDPR outcome without it: HGB
// needs the accounting facts (status/tier/period), not the Stripe/Mollie
// subject identifiers.
const REDACTED_PII_VALUE = "[erased]";

/** Tenant-destroy hook for billing PII (#800). HGB retains the accounting
 *  row but redacts the two provider-subject PII fields; other profiles
 *  hard-delete the row. Either way the subscription stream is archived so a
 *  future projection rebuild can't resurrect what was erased. */
export async function subscriptionTenantDestroyHook(ctx: {
  readonly db: import("@cosmicdrift/kumiko-framework/db").DbRunner;
  readonly tenantId: TenantId;
}): Promise<void> {
  const { profile } = await resolveProfileForTenant({
    db: ctx.db,
    tenantId: ctx.tenantId,
  });
  const aggregateId = subscriptionAggregateId(ctx.tenantId);
  if (profile.key === "de-hr-dsgvo-hgb") {
    await updateMany(
      ctx.db,
      subscriptionsProjectionTable as EntityTableMeta,
      { providerCustomerId: REDACTED_PII_VALUE, providerSubscriptionId: REDACTED_PII_VALUE },
      { id: aggregateId },
    );
  } else {
    await deleteMany(ctx.db, subscriptionsProjectionTable as EntityTableMeta, { id: aggregateId });
  }
  await archiveStream(ctx.db, {
    tenantId: ctx.tenantId,
    aggregateId,
    aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
    archivedBy: "tenant-lifecycle:destroy",
    reason: "tenant_destroy",
  });
}
