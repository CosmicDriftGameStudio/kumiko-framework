// Resolver-helper: liest die current subscription-row für einen Tenant.
// Apps die tier-engine + subscription-foundation kombinieren benutzen
// diesen Helper statt selbst gegen `subscription`-table zu queryn —
// damit foundation-Schema-Änderungen nur eine Stelle aktualisieren.

import { createEntityExecutor, type HandlerContext } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { subscriptionAggregateId } from "./aggregate-id";
import { subscriptionEntity } from "./entities";

const { table: subTable } = createEntityExecutor("subscription", subscriptionEntity);

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
  const [row] = await ctx.db.select().from(subTable).where(eq(subTable["id"], aggId)).limit(1);
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
