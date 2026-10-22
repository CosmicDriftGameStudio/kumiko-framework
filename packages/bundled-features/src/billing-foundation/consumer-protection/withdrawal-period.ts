import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { SUBSCRIPTION_CREATED_EVENT_QN } from "../events.ts";

// § 355 BGB: the withdrawal period is 14 days from conclusion of the contract.
export const WITHDRAWAL_PERIOD_DAYS = 14;
const HOURS_PER_DAY = 24;

type PeriodStartEvent = { readonly type: string; readonly createdAt: Temporal.Instant };

/** The period runs from the latest subscription start on the stream. A checkout
 *  consent alone never restarts it: it is written before the buyer reaches the
 *  provider, so an abandoned plan-change checkout would otherwise reopen the
 *  period of a long-concluded contract. A stream without a subscription start
 *  has no provable start and counts as expired. */
export function isWithinWithdrawalPeriod(
  events: readonly PeriodStartEvent[],
  now: Temporal.Instant,
): boolean {
  let latestStart: Temporal.Instant | undefined;
  for (const event of events) {
    if (event.type !== SUBSCRIPTION_CREATED_EVENT_QN) continue;
    if (
      latestStart === undefined ||
      event.createdAt.epochMilliseconds > latestStart.epochMilliseconds
    ) {
      latestStart = event.createdAt;
    }
  }
  // skip: no subscription-created event, nothing proves a running period
  if (latestStart === undefined) return false;
  const periodEnd = latestStart.add({ hours: WITHDRAWAL_PERIOD_DAYS * HOURS_PER_DAY });
  return now.epochMilliseconds <= periodEnd.epochMilliseconds;
}
