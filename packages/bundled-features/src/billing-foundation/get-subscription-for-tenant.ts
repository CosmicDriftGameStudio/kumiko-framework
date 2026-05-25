// Resolver-helper: liest die current subscription-row für einen Tenant
// aus der read_subscriptions-projection.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { subscriptionAggregateId } from "./aggregate-id";
import { subscriptionsProjectionTable } from "./projection";

export type SubscriptionView = {
  readonly tier: string;
  readonly status: string;
  readonly providerName: string;
  readonly providerCustomerId: string;
  readonly providerSubscriptionId: string;
};

/** Liefert die einzige subscription-row für den Tenant (deterministic
 *  aggregate-id), oder null wenn der Tenant nie subscribed hat. Status
 *  kann active/canceled/past_due/etc sein — Caller entscheidet was tun. */
export async function getSubscriptionForTenant(
  ctx: HandlerContext,
  tenantId: string,
): Promise<SubscriptionView | null> {
  const aggId = subscriptionAggregateId(tenantId);
  const rows = await ctx.db.selectMany(subscriptionsProjectionTable, { id: aggId }, { limit: 1 });
  const row = rows[0];
  if (!row) return null;
  // @cast-boundary db-row — drizzle-row carries column-as-unknown
  return {
    tier: row["tier"] as string,
    status: row["status"] as string,
    providerName: row["providerName"] as string,
    providerCustomerId: row["providerCustomerId"] as string,
    providerSubscriptionId: row["providerSubscriptionId"] as string,
  };
}
