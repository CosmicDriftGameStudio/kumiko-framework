// An in-app plan switch changes the tier only when the provider's webhook arrives. Until then a
// second submit (double click, retry after a timeout) would pass the pre-checks and switch again.

import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError } from "@cosmicdrift/kumiko-framework/errors";
import { subscriptionAggregateId } from "./aggregate-id.ts";
import {
  PLAN_SWITCH_REQUESTED_EVENT_QN,
  type PlanSwitchRequestedPayload,
  planSwitchRequestedPayloadSchema,
  SUBSCRIPTION_AGGREGATE_TYPE,
  SUBSCRIPTION_CANCELED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_QN,
} from "./events.ts";

// A webhook that never arrives must not block switching forever.
const PENDING_PLAN_SWITCH_WINDOW_SECONDS = 30 * 60;
// 'bfps': serializes the pending check and the append per tenant.
const PLAN_SWITCH_LOCK_NAMESPACE = 0x62667073;

const STATE_EVENT_QNS: ReadonlySet<string> = new Set([
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_QN,
  SUBSCRIPTION_CANCELED_EVENT_QN,
]);

export function pendingPlanSwitchOf(
  storedEvents: readonly { readonly type: string; readonly payload: unknown }[],
  now: Temporal.Instant,
): PlanSwitchRequestedPayload | undefined {
  for (let index = storedEvents.length - 1; index >= 0; index--) {
    const stored = storedEvents[index];
    if (stored === undefined) continue;
    if (STATE_EVENT_QNS.has(stored.type)) return undefined;
    if (stored.type !== PLAN_SWITCH_REQUESTED_EVENT_QN) continue;
    const parsed = planSwitchRequestedPayloadSchema.safeParse(stored.payload);
    if (!parsed.success) continue;
    const ageSeconds = now
      .since(Temporal.Instant.from(parsed.data.requestedAtIso))
      .total("seconds");
    return ageSeconds < PENDING_PLAN_SWITCH_WINDOW_SECONDS ? parsed.data : undefined;
  }
  return undefined;
}

export async function assertNoPendingPlanSwitch(
  ctx: HandlerContext,
  now: Temporal.Instant,
): Promise<void> {
  const tenantId = ctx.user.tenantId;
  await ctx.db.advisoryXactLock(PLAN_SWITCH_LOCK_NAMESPACE, tenantId);
  const pending = pendingPlanSwitchOf(
    await ctx.events.load(subscriptionAggregateId(tenantId)),
    now,
  );
  if (pending !== undefined) {
    throw new ConflictError({
      i18nKey: "billing-foundation.errors.planSwitchPending",
      message: `a switch to plan "${pending.tier}" is still waiting for the provider's confirmation`,
    });
  }
}

export async function recordPlanSwitchRequested(
  ctx: HandlerContext,
  request: { readonly tier: string; readonly priceId: string; readonly now: Temporal.Instant },
): Promise<void> {
  const payload: PlanSwitchRequestedPayload = {
    tier: request.tier,
    priceId: request.priceId,
    requestedAtIso: request.now.toString(),
  };
  await ctx.events.unsafeAppend({
    aggregateId: subscriptionAggregateId(ctx.user.tenantId),
    aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
    type: PLAN_SWITCH_REQUESTED_EVENT_QN,
    payload,
  });
}
