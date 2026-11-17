// cap-counter — Counter Storage + Increment API + Soft-Warn State.
//
// **What this feature provides:**
//   1. Calendar counters are rows in the store table store_cap_counters (per tenant, capName,
//      period, plus optional per-subject rows) for calendar-period caps (mail/month,
//      egress/month), booked with an atomic upsert.
//   2. increment handler — atomic counter increment through that upsert.
//   3. increment-rolling handler — adds the amount to the current UTC hour's
//      bucket row (store_cap_rolling_usage) for rolling-window caps.
//   4. mark-soft-warned handler — flips the anti-notification-storm flag
//      (calendar-period counters only).
//   5. get-counter query — synchronous read of the current counter value
//      (calendar period).
//   6. enforceCap helper (see enforce-cap.ts) — pre-save wrapper with
//      asymmetric soft and hard tolerances per cap profile.
//
// **Calendar vs. rolling — when to use which:**
//   - **Calendar period** (bookCapUsage + enforceCap): the cap resets at
//     period start (the first of the month, etc.). The counter is one row
//     in the store table, enabling fast reads.
//   - **Rolling window** (CapCounterHandlers.incrementRolling + readRollingCapUsage):
//     hourly buckets, reads sum the buckets of the last N days.
//
// **What this feature does NOT do:**
//   - **No foundation wiring.** mail-foundation / file-foundation /
//     ai-foundation are BYOK by default and currently have no platform pool
//     to count. cap-counter is generic: an app owner who wants to use the
//     counter calls `bookCapUsage(...)` /
//     `ctx.dispatch.write(CapCounterHandlers.incrementRolling, ...)` from their own handler.
//   - **No reset cron for the calendar period.** It works without one: period rollover starts a
//     new row. Old tenant rows remain for billing.
//   - **No notification path is hard-wired.** cap-counter is decoupled —
//     `enforceCapAndMaybeNotify` (see enforce-cap.ts) is a convenience helper
//     that invokes a caller-supplied emit callback; cap-counter does not know
//     the delivery feature directly.
//
// **Boot dependencies:** none. cap-counter is plain vanilla — it needs no
// config, secrets, or tenant feature. Tenant scoping comes from the framework
// default (Base-Column tenantId).

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { CAP_COUNTER_FEATURE } from "./constants.ts";
import { getCounterQuery } from "./handlers/get-counter.query.ts";
import { incrementCapHandler } from "./handlers/increment.write.ts";
import { incrementRollingCapHandler } from "./handlers/increment-rolling.write.ts";
import { markSoftWarnedHandler } from "./handlers/mark-soft-warned.write.ts";
import {
  capCountersTableMeta,
  capReservationsTableMeta,
  rollingCapUsageTableMeta,
} from "./tables.ts";

export function createCapCounterFeature() {
  return defineFeature(
    CAP_COUNTER_FEATURE,
    (r) => {
      r.describe(
        "Tracks per-tenant usage against configurable limits using two storage models: calendar-period counters (rows in the store table store_cap_counters per tenant/capName/period plus optional per-subject rows, booked with an atomic upsert; period rollover starts a new row) and rolling-window counters (hourly usage buckets in a store table, summed over the last N days). Wrap write-handlers with `withCapEnforcement` (or call `enforceCap` / `enforceCapAndMaybeNotify`) for calendar caps with soft-warn and hard-block tolerances; book rolling usage through the SystemAdmin-only `increment-rolling` handler and read it with `readRollingCapUsage`.",
      );
      r.uiHints({
        displayLabel: "Cap Counter · Usage Limits",
        category: "operations",
        recommended: false,
      });
      r.storeTable(capCountersTableMeta, { reason: "coordination.cap_usage_counters" });
      r.storeTable(capReservationsTableMeta, {
        reason: "coordination.cap_reservation_ledger",
      });
      r.storeTable(rollingCapUsageTableMeta, { reason: "coordination.cap_rolling_usage_buckets" });

      // Custom write-handlers.
      // - increment: calendar period (atomic counter upsert).
      // - increment-rolling: rolling window (hourly bucket upsert).
      // - mark-soft-warned: anti-notification-storm flag (calendar only).
      r.writeHandler(incrementCapHandler);
      r.writeHandler(incrementRollingCapHandler);
      r.writeHandler(markSoftWarnedHandler);
      r.queryHandler(getCounterQuery);
    },
    { dedupeOptions: {} },
  );
}
