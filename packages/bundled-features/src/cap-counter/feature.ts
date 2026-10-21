// cap-counter — Counter Storage + Increment API + Soft-Warn State.
//
// **What this feature provides:**
//   1. r.entity({ name: "cap-counter" }) — counter rows per (tenant, capName,
//      period) for calendar-period caps (mail/month, egress/month).
//   2. increment handler — atomic counter increment via deterministic
//      aggregate-id (try-create / executor-update), made race-free by the
//      event-store optimistic lock.
//   3. increment-rolling handler — append-only custom-event stream for
//      rolling-window caps (AI-tokens-7d, egress-24h). No projection; the
//      value is read from the event stream.
//   4. mark-soft-warned handler — flips the anti-notification-storm flag
//      (calendar-period counters only).
//   5. get-counter query — synchronous read of the current counter value
//      (calendar period).
//   6. enforceCap + enforceRollingCap helpers (see enforce-cap.ts) —
//      pre-save wrappers with asymmetric soft and hard tolerances per
//      cap profile.
//
// **Calendar vs. rolling — when to use which:**
//   - **Calendar period** (bookCapUsage + enforceCap): the cap resets at
//     period start (the first of the month, etc.). The counter is one row in
//     the projection, enabling fast reads.
//   - **Rolling window** (CapCounterHandlers.incrementRolling + enforceRollingCap):
//     the cap rolls continuously (e.g. "last 7 days"). Values expire event
//     by event without a reset. There is no projection; reads sum the events
//     from the last N days.
//
// **What this feature does NOT do:**
//   - **No foundation wiring.** mail-foundation / file-foundation /
//     ai-foundation are BYOK by default and currently have no platform pool
//     to count. cap-counter is generic: an app owner who wants to use the
//     counter calls `bookCapUsage(...)` /
//     `ctx.write(CapCounterHandlers.incrementRolling, ...)` from their own handler.
//   - **No reset cron for the calendar period.** It works without one: the
//     periodStartIso part of the aggregate id rolls over to a fresh counter
//     at the period boundary. Old rows remain for auditing.
//   - **No notification path is hard-wired.** cap-counter is decoupled —
//     `enforceCapAndMaybeNotify` (see enforce-cap.ts) is a convenience helper
//     that invokes a caller-supplied emit callback; cap-counter does not know
//     the delivery feature directly.
//
// **Boot dependencies:** none. cap-counter is plain vanilla — it needs no
// config, secrets, or tenant feature. Tenant scoping comes from the framework
// default (Base-Column tenantId).

import {
  access,
  defineEntityListHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  CAP_COUNTER_FEATURE,
  CAP_COUNTER_LIST_SCREEN_ID,
  ROLLING_INCREMENTED_EVENT_SHORT,
  ROLLING_RELEASED_EVENT_SHORT,
} from "./constants.ts";
import { capCounterEntity } from "./entity.ts";
import { getCounterQuery } from "./handlers/get-counter.query.ts";
import { incrementCapHandler } from "./handlers/increment.write.ts";
import {
  incrementRollingCapHandler,
  rollingIncrementedSchema,
  rollingReleasedSchema,
} from "./handlers/increment-rolling.write.ts";
import { markSoftWarnedHandler } from "./handlers/mark-soft-warned.write.ts";
import { CAP_COUNTER_I18N } from "./i18n.ts";
import { capReservationsTableMeta } from "./tables.ts";

export function createCapCounterFeature() {
  return defineFeature(
    CAP_COUNTER_FEATURE,
    (r) => {
      r.describe(
        "Tracks per-tenant usage against configurable limits using two complementary storage models: calendar-period counters (one projection row per tenant/capName/period, reset implicitly by period rollover) and rolling-window counters (append-only event stream, no projection). Use `enforceCap` / `enforceRollingCap` (or the `withCapEnforcement` / `withRollingCapEnforcement` handler wrappers) in your write-handlers to check limits with soft-warn and hard-block tolerances; call `enforceCapAndMaybeNotify` when you also want to trigger a delivery notification on soft-threshold hits.",
      );
      r.uiHints({
        displayLabel: "Cap Counter · Usage Limits",
        category: "operations",
        recommended: false,
      });
      r.entity({ name: "cap-counter", ...capCounterEntity });
      r.storeTable(capReservationsTableMeta, {
        reason: "coordination.cap_reservation_ledger",
      });

      // Custom domain event for the rolling counter. r.defineEvent registers the
      // schema with the registry; ctx.unsafeAppendEvent in the handler reuses the
      // same schema for append-time validation. QN after prefixing:
      // "cap-counter:event:rolling-incremented" (see
      // ROLLING_INCREMENTED_EVENT_QN).
      r.defineEvent(ROLLING_INCREMENTED_EVENT_SHORT, rollingIncrementedSchema, {
        piiFields: "none",
      });
      r.defineEvent(ROLLING_RELEASED_EVENT_SHORT, rollingReleasedSchema, { piiFields: "none" });

      // Custom write-handlers.
      // - increment: calendar period (CRUD via projection row).
      // - increment-rolling: rolling window (custom event, no projection).
      // - mark-soft-warned: anti-notification-storm flag (calendar only).
      r.writeHandler(incrementCapHandler);
      r.writeHandler(incrementRollingCapHandler);
      r.writeHandler(markSoftWarnedHandler);

      // Custom + standard reads. Sysadmin cross-tenant via list, per-tenant
      // single row via get-counter. Detail-by-id handler left out on purpose
      // (no use case; the natural lookup is capName + period, not the
      // aggregate id).
      r.queryHandler(
        defineEntityListHandler("cap-counter", capCounterEntity, {
          access: { roles: access.systemAdmin },
          escapeHatch: {
            reason:
              "SystemAdmin quota operator view lists usage counters of every tenant to see who consumes which cap",
          },
          description:
            "Lists usage-counter rows across all tenants with cap name, current value, period start and soft-warn timestamp; use it as the operator view of who is consuming which quota.",
        }),
      );
      r.queryHandler(getCounterQuery);

      r.screen({
        id: CAP_COUNTER_LIST_SCREEN_ID,
        type: "entityList",
        entity: "cap-counter",
        columns: [
          "tenantId",
          "capName",
          "value",
          "periodStart",
          { field: "lastSoftWarnedAt", hideOnNarrow: true },
        ],
        defaultSort: { field: "capName", dir: "asc" },
        // Search resolves against the caller's own tenant stream, so on this
        // cross-tenant operator list it would only ever hit the SystemAdmin's tenant.
        searchable: false,
        access: { roles: ["SystemAdmin"] },
      });
      r.nav({
        id: "cap-list",
        label: "cap-counter:nav.cap-list",
        screen: "cap-counter:screen:cap-list",
        icon: "gauge",
        order: 60,
      });
      r.translations({
        keys: {
          ...CAP_COUNTER_I18N,
          "cap-counter:nav.cap-list": { de: "Limits", en: "Caps" },
        },
      });
    },
    { dedupeOptions: {} },
  );
}
