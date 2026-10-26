// Paddle's subscription entity and its mapping onto the foundation's state.
// Shared by the webhook and retrieveSubscription so both map identically.

import {
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import * as z from "zod";

const PADDLE_SUBSCRIPTION_STATUSES: Readonly<Record<string, SubscriptionStatus>> = {
  active: SubscriptionStatuses.active,
  trialing: SubscriptionStatuses.trialing,
  past_due: SubscriptionStatuses.pastDue,
  paused: SubscriptionStatuses.pastDue,
  canceled: SubscriptionStatuses.canceled,
};

const SCHEDULED_CANCEL_ACTION = "cancel";

const instantSchema = z.iso.datetime({ offset: true });

export const paddleCustomDataSchema = z.record(z.string(), z.unknown()).nullish();

export const paddleSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  customer_id: z.string().min(1),
  items: z.array(z.object({ price: z.object({ id: z.string().min(1) }) })),
  custom_data: paddleCustomDataSchema,
  current_billing_period: z.object({ ends_at: instantSchema }).nullish(),
  next_billed_at: instantSchema.nullish(),
  scheduled_change: z.object({ action: z.string(), effective_at: instantSchema }).nullish(),
  canceled_at: instantSchema.nullish(),
});
export type PaddleSubscription = z.infer<typeof paddleSubscriptionSchema>;

export type MappedPaddleSubscriptionState = {
  readonly status: SubscriptionStatus;
  readonly tier: string;
  readonly currentPeriodEnd: string;
  readonly cancelAt: string | null;
};

/** Null when the status is unknown, no item's price is in `priceToTier`
 *  (SubscriptionEvent.tier is required) or no period end can be derived. */
export function mapPaddleSubscriptionState(
  sub: PaddleSubscription,
  priceToTier: Readonly<Record<string, string>>,
): MappedPaddleSubscriptionState | null {
  const status = Object.hasOwn(PADDLE_SUBSCRIPTION_STATUSES, sub.status)
    ? PADDLE_SUBSCRIPTION_STATUSES[sub.status]
    : undefined;
  const tier = sub.items
    .map((item) =>
      Object.hasOwn(priceToTier, item.price.id) ? priceToTier[item.price.id] : undefined,
    )
    .find((name) => name);
  const currentPeriodEnd =
    sub.current_billing_period?.ends_at ?? sub.next_billed_at ?? sub.canceled_at;
  if (!status || !tier || !currentPeriodEnd) return null;
  const scheduled = sub.scheduled_change;
  return {
    status,
    tier,
    currentPeriodEnd,
    cancelAt: scheduled?.action === SCHEDULED_CANCEL_ACTION ? scheduled.effective_at : null,
  };
}
