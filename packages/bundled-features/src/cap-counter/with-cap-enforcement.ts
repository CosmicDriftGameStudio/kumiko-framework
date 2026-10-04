// withCapEnforcement / withRollingCapEnforcement: handler wrappers that put the
// pre-call enforceCapAndMaybeNotify and a reservation around the wrapped handler.
//
// **Why a wrapper instead of manual calls in the handler:** a cap-bound handler
// must not forget the enforce pre-call, the reservation or the release on failure;
// the wrapper keeps the pattern explicit and co-located.
//
// **Calendar reservation:** the wrapper only declares the cap; the dispatcher runs the
// reservation (reserveBeforeTransaction) before the handler transaction opens, in its own short
// committed write, and releases it after that transaction ended without committing (rollback,
// failure result, failed COMMIT). No connection is held across the handler, so capped requests
// cannot exhaust the pool, and the counter stream is not locked while the handler runs. If a
// COMMIT fails with an unknown outcome the release can under-count; a wrapped handler must not
// book the same counter itself. Reached through a nested ctx.write the cap is not reserved, so
// the dispatcher rejects that call unless the top-level batch reserved the same handler.
//
// Rolling booking still dispatches the SystemAdmin-only increment-rolling
// handler and has no reservation: it would need a compensating event type,
// a changed readRollingCapUsage and a version-guarded append behind the
// SystemAdmin dispatch. Rolling callers need a SystemAdmin identity until
// cap-counter declares an explicit foreign-booking opt-in.
//
// No automatic markSoftWarned here — that's inside enforceCapAndMaybeNotify
// (enforce-cap.ts).

import type {
  HandlerContext,
  WriteEvent,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { reraiseAsKumikoError } from "@cosmicdrift/kumiko-framework/errors";
import { bookCapUsage, releaseCapUsage } from "./book-cap-usage.js";
import { CapCounterHandlers } from "./constants.js";
import {
  assertBelowHardCap,
  type CapToleranceProfileName,
  enforceCapAndMaybeNotify,
  enforceRollingCapAndMaybeNotify,
  type SoftHitNotifier,
} from "./enforce-cap.js";

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
    reserveBeforeTransaction: async (event, ctx) => {
      const cap = await capResolver(event, ctx);

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
      const reserved = await bookCapUsage(ctx, {
        capName: cap.capName,
        amount,
        periodStartIso: cap.periodStartIso,
        outsideTransaction: true,
        guardCurrentValue: (currentValue) => assertBelowHardCap(currentValue + amount - 1, cap),
      });
      if (!reserved.isSuccess) throw reraiseAsKumikoError(reserved.error);

      return async () => {
        const released = await releaseCapUsage(ctx, {
          capName: cap.capName,
          amount,
          periodStartIso: cap.periodStartIso,
          outsideTransaction: true,
        });
        if (!released.isSuccess) throw reraiseAsKumikoError(released.error);
      };
    },
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
 * Same flow as `withCapEnforcement` but uses
 * `enforceRollingCapAndMaybeNotify` + dispatches
 * `cap-counter:write:increment-rolling` post-success.
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
    name: handler.name,
    schema: handler.schema,
    access: handler.access,
    handler: async (event, ctx) => {
      const cap = await capResolver(event, ctx);

      await enforceRollingCapAndMaybeNotify(ctx, {
        capName: cap.capName,
        windowDays: cap.windowDays,
        limit: cap.limit,
        profile: cap.profile,
        notify: cap.notify,
      });

      const result = await handler.handler(event, ctx);

      if (result.isSuccess) {
        await ctx.write(CapCounterHandlers.incrementRolling, {
          capName: cap.capName,
          amount: cap.amount ?? 1,
        });
      }

      return result;
    },
  };
}
