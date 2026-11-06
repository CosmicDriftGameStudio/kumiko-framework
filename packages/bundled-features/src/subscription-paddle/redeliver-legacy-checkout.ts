// While the takeover window of the checkout-ledger backfill is open, a Paddle event of a legacy
// checkout (custom_data still has the tenantBinding) that billing-foundation ignored as
// "not in the ledger" may only be waiting for the next sweep. Answering it with a retryable
// 5xx makes Paddle deliver it again once the sweep has ledgered the checkout.

import type { SignatureExtraRouteDeps } from "@cosmicdrift/kumiko-framework/api";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { FrameworkErrorCode } from "@cosmicdrift/kumiko-framework/errors";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { isTakeoverWindowOver } from "./backfill-checkout-ledger.ts";
import {
  LEDGER_BACKFILL_MARKER_HANDLER_QN,
  type LedgerBackfillMarkerResult,
} from "./ledger-backfill-marker.ts";
import { hasLegacyTenantBinding } from "./webhook-events.ts";

const log = createFallbackLogger("subscription-paddle");

// A retry cannot fix these: the marker handler is missing, disabled or not permitted.
const MARKER_CONFIGURATION_ERROR_CODES = [
  "access_denied",
  "not_found",
  "feature_disabled",
] as const satisfies readonly FrameworkErrorCode[];

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
  if (!marker.isSuccess) {
    // tenantBinding is client-settable, so a permanent failure must not turn into endless 503s.
    if (isOneOf(MARKER_CONFIGURATION_ERROR_CODES, marker.error.code)) {
      log.warn("ledger backfill marker not readable, not redelivering", {
        errorCode: marker.error.code,
      });
      return false;
    }
    // Transient or internal: Paddle redelivers only a bounded number of times, so retrying is safe.
    return true;
  }
  const { completedAt } = marker.data as LedgerBackfillMarkerResult; // @cast-boundary engine-payload
  if (completedAt === null) return true;
  return !isTakeoverWindowOver(completedAt, (args.now ?? Temporal.Now.instant)());
}
