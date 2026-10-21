/// <reference types="temporal-polyfill/global" preserve="true" />

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { subscriptionAggregateId } from "./aggregate-id.ts";
import { SUBSCRIPTION_PII_FIELDS } from "./entities.ts";
import { subscriptionsProjectionTable } from "./projection.ts";

export type SubscriptionView = {
  readonly tier: string;
  readonly status: string;
  readonly providerName: string;
  readonly providerCustomerId: string;
  readonly providerSubscriptionId: string;
  readonly currentPeriodEnd: Temporal.Instant;
  /** When the subscription ends because of a cancellation. null = it
   *  renews. */
  readonly cancelAt: Temporal.Instant | null;
  /** `modified_at ?? inserted_at` — the projection's own base columns.
   *  `modified_at` is null only for pre-existing rows written before every
   *  apply-function started stamping it from `event.createdAt`. */
  readonly lastChangedAt: Temporal.Instant;
};

/** Returns the tenant's only subscription row (deterministic
 *  aggregate ID), or null if the tenant has never subscribed. The status
 *  may be active/canceled/past_due/etc.; the caller decides what to do. */
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
    ? await decryptPiiFieldValues(row, SUBSCRIPTION_PII_FIELDS, piiKms, {
        requestId: `billing-foundation:get-subscription:${tenantId}`,
      })
    : row;
  // @cast-boundary db-row — drizzle-row carries column-as-unknown
  return {
    tier: decrypted["tier"] as string,
    status: decrypted["status"] as string,
    providerName: decrypted["providerName"] as string,
    providerCustomerId: decrypted["providerCustomerId"] as string,
    providerSubscriptionId: decrypted["providerSubscriptionId"] as string,
    currentPeriodEnd: decrypted["currentPeriodEnd"] as Temporal.Instant,
    cancelAt: (decrypted["cancelAt"] ?? null) as Temporal.Instant | null,
    lastChangedAt: (decrypted["modifiedAt"] ?? decrypted["insertedAt"]) as Temporal.Instant,
  };
}
