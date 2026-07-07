// Resolver-helper: liest die current subscription-row für einen Tenant
// aus der read_subscriptions-projection.

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { subscriptionAggregateId } from "./aggregate-id";
import { SUBSCRIPTION_PII_FIELDS } from "./entities";
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
  const piiKms = configuredPiiSubjectKms();
  const decrypted = piiKms
    ? await decryptPiiFieldValues(row as Record<string, unknown>, SUBSCRIPTION_PII_FIELDS, piiKms, {
        requestId: `billing-foundation:get-subscription:${tenantId}`,
      })
    : (row as Record<string, unknown>);
  // @cast-boundary db-row — drizzle-row carries column-as-unknown
  return {
    tier: decrypted["tier"] as string,
    status: decrypted["status"] as string,
    providerName: decrypted["providerName"] as string,
    providerCustomerId: decrypted["providerCustomerId"] as string,
    providerSubscriptionId: decrypted["providerSubscriptionId"] as string,
  };
}
