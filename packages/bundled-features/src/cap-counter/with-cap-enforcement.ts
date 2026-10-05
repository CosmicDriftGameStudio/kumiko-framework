// withCapEnforcement / withRollingCapEnforcement: handler wrappers that put the
// pre-call enforceCapAndMaybeNotify and a reservation around the wrapped handler.
//
// **Why a wrapper instead of manual calls in the handler:** a cap-bound handler
// must not forget the enforce pre-call, the reservation or the release on failure;
// the wrapper keeps the pattern explicit and co-located.
//
// **Calendar reservation:** the wrapper only declares the cap; the dispatcher runs the
// reservation (reserveBeforeTransaction) after all pre-handler gates and before the handler
// transaction opens, in its own short committed write (counter increment plus a
// store_cap_reservations row). The handler transaction deletes the row on its own commit; a release
// after a rollback, failure result or failed COMMIT only gives back what is still booked, so an
// unknown COMMIT outcome cannot under-count. No connection is held across the handler. Rows a
// crashed process left behind expire after CAP_RESERVATION_TTL_MINUTES and are given back before the
// next reserve of the same cap. Reached through a nested ctx.write the cap is not reserved, so the
// dispatcher rejects that call unless the top-level batch reserved the same handler.
//
// The wrapper spreads the wrapped handler and chains its reserveBeforeTransaction: inner reserves
// first, release runs in reverse, and an outer failure gives the inner reservation back.
//
// Rolling caps reserve the same way: a version-guarded `rolling-incremented` append plus a
// reservation row, undone by a `rolling-released` event. The window sum is incremented minus released.
//
// No automatic markSoftWarned here — that's inside enforceCapAndMaybeNotify
// (enforce-cap.ts).

import type {
  HandlerContext,
  WriteEvent,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  releaseExpiredCapReservations,
  reserveCalendarCap,
  reserveRollingCap,
} from "./cap-reservation.js";
import {
  assertBelowHardCap,
  type CapToleranceProfileName,
  enforceCapAndMaybeNotify,
  enforceRollingCapAndMaybeNotify,
  type SoftHitNotifier,
} from "./enforce-cap.js";
import { chainReservations } from "./reservation-chain.js";

// =============================================================================
// Calendar-Period-Wrapper
// =============================================================================

/**
 * Pro-call dynamische Cap-Definition. Wird vor jedem Handler-Aufruf
 * neu evaluiert — typischer Caller liest hier den Tenant-Tier aus
 * dem ctx, mappt ihn auf einen Limit-Wert. `amount` default 1 (count-
 * events); für byte/token-cap übergibt der Caller die Größe aus
 * `event.payload`.
 */
export type CalendarCapDef = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly limit: number;
  readonly profile: CapToleranceProfileName;
  /** Increment-amount post-success. Default 1. */
  readonly amount?: number;
  readonly notify: SoftHitNotifier;
};

/** Resolver-fn that the wrapper calls before each handler invocation
 *  to compute the cap-spec for THIS request (e.g. limit derived from
 *  tenant-tier). Sync OR async — async lets the caller fetch the
 *  tier from DB. */
export type CalendarCapResolver = (
  event: WriteEvent,
  ctx: HandlerContext,
) => Promise<CalendarCapDef> | CalendarCapDef;

/**
 * Wrap a write-handler with calendar-period cap-enforcement.
 *
 * Flow (all before the handler transaction, in the dispatcher):
 *   1. resolve cap-spec via `capResolver(event, ctx)`
 *   2. `enforceCapAndMaybeNotify` — throws CapExceededError on hard-hit
 *      (handler never runs), notifies on soft-hit-crossing
 *   3. reserve `amount` (hard-cap check + increment in one short, immediately committed write)
 *   4. the returned release gives the amount back if the transaction does not commit
 */
export function withCapEnforcement(
  handler: WriteHandlerDef,
  capResolver: CalendarCapResolver,
): WriteHandlerDef {
  return {
    ...handler,
    reserveBeforeTransaction: chainReservations(
      handler.reserveBeforeTransaction,
      async (event, ctx) => {
        const cap = await capResolver(event, ctx);

        await releaseExpiredCapReservations(ctx, cap.capName);
        await enforceCapAndMaybeNotify(ctx, {
          capName: cap.capName,
          periodStartIso: cap.periodStartIso,
          limit: cap.limit,
          profile: cap.profile,
          notify: cap.notify,
          markSoftWarnedOutsideTransaction: true,
          ...(cap.amount !== undefined && { amount: cap.amount }),
        });

        const amount = cap.amount ?? 1;
        return reserveCalendarCap(ctx, {
          capName: cap.capName,
          amount,
          periodStartIso: cap.periodStartIso,
          guardCurrentValue: (currentValue) => assertBelowHardCap(currentValue + amount - 1, cap),
        });
      },
    ),
  };
}

// =============================================================================
// Rolling-Window-Wrapper
// =============================================================================

export type RollingCapDef = {
  readonly capName: string;
  readonly windowDays: number;
  readonly limit: number;
  readonly profile: CapToleranceProfileName;
  readonly amount?: number;
  readonly notify: SoftHitNotifier;
};

export type RollingCapResolver = (
  event: WriteEvent,
  ctx: HandlerContext,
) => Promise<RollingCapDef> | RollingCapDef;

/**
 * Wrap a write-handler with rolling-window cap-enforcement.
 *
 * Same flow as `withCapEnforcement` but uses `enforceRollingCapAndMaybeNotify` and reserves by
 * appending a `rolling-incremented` event before the handler transaction; a release appends
 * `rolling-released`.
 *
 * **Notification-Storm-Caveat:** rolling-counter trackt KEIN
 * lastSoftWarnedAt — der Notifier feuert bei JEDEM Call solange
 * der counter im soft-Bereich ist. Caller sollte einen TTL-Cache
 * (`Map<capName, lastNotifiedAt>`) im notify-callback einbauen.
 */
export function withRollingCapEnforcement(
  handler: WriteHandlerDef,
  capResolver: RollingCapResolver,
): WriteHandlerDef {
  return {
    ...handler,
    reserveBeforeTransaction: chainReservations(
      handler.reserveBeforeTransaction,
      async (event, ctx) => {
        const cap = await capResolver(event, ctx);

        await releaseExpiredCapReservations(ctx, cap.capName);
        await enforceRollingCapAndMaybeNotify(ctx, {
          capName: cap.capName,
          windowDays: cap.windowDays,
          limit: cap.limit,
          profile: cap.profile,
          notify: cap.notify,
        });

        const amount = cap.amount ?? 1;
        return reserveRollingCap(ctx, {
          capName: cap.capName,
          windowDays: cap.windowDays,
          amount,
          guardCurrentValue: (usage) => assertBelowHardCap(usage + amount - 1, cap),
        });
      },
    ),
  };
}
