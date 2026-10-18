import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { CHECKOUT_CONSENT_RECORDED_EVENT_QN, SUBSCRIPTION_CREATED_EVENT_QN } from "../events.ts";

// § 355 BGB: the withdrawal period is 14 days from conclusion of the contract.
export const WITHDRAWAL_PERIOD_DAYS = 14;
const HOURS_PER_DAY = 24;

const PERIOD_START_EVENT_TYPES: ReadonlySet<string> = new Set([
  CHECKOUT_CONSENT_RECORDED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_QN,
]);

type PeriodStartEvent = { readonly type: string; readonly createdAt: Temporal.Instant };

/** The period runs from the latest consent or subscription start on the stream.
 *  A stream with neither has no provable start and counts as expired. */
export function isWithinWithdrawalPeriod(
  events: readonly PeriodStartEvent[],
  now: Temporal.Instant,
): boolean {
  let latestStart: Temporal.Instant | undefined;
  for (const event of events) {
    if (!PERIOD_START_EVENT_TYPES.has(event.type)) continue;
    if (
      latestStart === undefined ||
      event.createdAt.epochMilliseconds > latestStart.epochMilliseconds
    ) {
      latestStart = event.createdAt;
    }
  }
  // skip: no consent or subscription-created event, nothing proves a running period
  if (latestStart === undefined) return false;
  const periodEnd = latestStart.add({ hours: WITHDRAWAL_PERIOD_DAYS * HOURS_PER_DAY });
  return now.epochMilliseconds <= periodEnd.epochMilliseconds;
}
