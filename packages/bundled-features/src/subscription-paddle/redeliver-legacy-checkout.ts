// While the takeover window of the checkout-ledger backfill is open, a Paddle event of a legacy
// checkout (custom_data still has the tenantBinding) that billing-foundation ignored as
// "not in the ledger" may only be waiting for the next sweep. Answering it with a retryable
// 5xx makes Paddle deliver it again once the sweep has ledgered the checkout.

import type { SignatureExtraRouteDeps } from "@cosmicdrift/kumiko-framework/api";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isTakeoverWindowOver } from "./backfill-checkout-ledger.ts";
import {
  LEDGER_BACKFILL_MARKER_HANDLER_QN,
  type LedgerBackfillMarkerResult,
} from "./ledger-backfill-marker.ts";
import { hasLegacyTenantBinding } from "./webhook-events.ts";

type IgnoredEvent = Parameters<typeof hasLegacyTenantBinding>[0];

export async function shouldRedeliverLegacyCheckout(args: {
  readonly event: IgnoredEvent;
  readonly reason: string;
  readonly deps: SignatureExtraRouteDeps;
  readonly now?: () => Temporal.Instant;
}): Promise<boolean> {
  if (!hasLegacyTenantBinding(args.event)) return false;
  const marker = await args.deps.dispatchWriteAs({
    handlerQn: LEDGER_BACKFILL_MARKER_HANDLER_QN,
    tenantId: SYSTEM_TENANT_ID,
    roles: [],
    payload: { markCompleted: false },
  });
  // Cannot tell whether the sweep is still open: err towards redelivery, Paddle retries a bounded number of times.
  if (!marker.isSuccess) return true;
  const { completedAt } = marker.data as LedgerBackfillMarkerResult; // @cast-boundary engine-payload
  if (completedAt === null) return true;
  return !isTakeoverWindowOver(completedAt, (args.now ?? Temporal.Now.instant)());
}
