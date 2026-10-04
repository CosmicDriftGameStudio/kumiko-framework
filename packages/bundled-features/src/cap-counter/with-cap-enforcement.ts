// withCapEnforcement / withRollingCapEnforcement — handler-wrapper die
// pre-call enforceCap-And-Notify + atomic reservation um den
// gewrappten Handler legen.
//
// **Warum Wrapper statt manuelle Calls im Handler:**
// Pattern-konsistenz. Wer einen cap-bedingten Handler schreibt,
// darf nicht vergessen den enforce-pre-call, die Reservierung oder
// den Release bei Fehlschlag zu machen. Wrapper macht das Pattern
// explizit + co-located.
//
// **Calendar reservation:** commits in its own short transaction
// (ctx.dbOutsideTransaction) BEFORE the handler, so it is NOT atomic
// with the handler's transaction. A failure result or throw is compensated
// by a release; a handler that succeeds but whose transaction then fails
// to commit leaves the counter over-counted. Without ctx.dbOutsideTransaction
// the reservation falls back to the handler transaction (atomic, but
// serializes capped calls on the same counter). A wrapped handler must not
// book the same counter inside its own transaction.
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
  WriteResult,
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

// A failed release only over-counts; it must neither mask the handler's own outcome nor stay invisible.
async function releaseReservationBestEffort(
  ctx: HandlerContext,
  cap: CalendarCapDef,
  amount: number,
  outsideTransaction: boolean,
): Promise<void> {
  try {
    const released = await releaseCapUsage(ctx, {
      capName: cap.capName,
      amount,
      periodStartIso: cap.periodStartIso,
      outsideTransaction,
    });
    if (!released.isSuccess) {
      ctx.log?.warn("cap-counter: releasing a cap reservation failed, counter is over-counted", {
        capName: cap.capName,
        code: released.error.code,
      });
    }
  } catch (error) {
    ctx.log?.warn("cap-counter: releasing a cap reservation threw, counter is over-counted", {
      capName: cap.capName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Wrap a write-handler with calendar-period cap-enforcement.
 *
 * Flow:
 *   1. resolve cap-spec via `capResolver(event, ctx)`
 *   2. pre-call: `enforceCapAndMaybeNotify` — throws CapExceededError
 *      on hard-hit (handler never runs), notifies on soft-hit-crossing
 *   3. reserve `amount` (hard-cap check + increment in one short, immediately committed write)
 *   4. invoke the wrapped handler; on failure result or throw, release the reservation
 *
 * The returned handler-def keeps the original name/schema/access
 * untouched — only the handler-fn is wrapped. The dispatcher sees
 * the same external contract.
 */
export function withCapEnforcement(
  handler: WriteHandlerDef,
  capResolver: CalendarCapResolver,
): WriteHandlerDef {
  return {
    name: handler.name,
    schema: handler.schema,
    access: handler.access,
    handler: async (event, ctx) => {
      const cap = await capResolver(event, ctx);

      // Pre-enforce. Hard-hit throws CapExceededError (extends KumikoError,
      // dispatcher auto-maps to HTTP 429 + cap_exceeded). Soft-hit-crossing
      // notifies via the supplied notifier + flips lastSoftWarnedAt.
      const outsideTransaction = ctx.dbOutsideTransaction !== undefined;
      await enforceCapAndMaybeNotify(ctx, {
        capName: cap.capName,
        periodStartIso: cap.periodStartIso,
        limit: cap.limit,
        profile: cap.profile,
        notify: cap.notify,
        markSoftWarnedOutsideTransaction: outsideTransaction,
        ...(cap.amount !== undefined && { amount: cap.amount }),
      });

      // The pre-check only drives the soft warning; the reservation is the hard gate. It commits at once in its own transaction (check and increment in one version-guarded write), so parallel calls cannot pass the same stale read and the counter stream is not held while the handler runs.
      const amount = cap.amount ?? 1;
      const reserved = await bookCapUsage(ctx, {
        capName: cap.capName,
        amount,
        periodStartIso: cap.periodStartIso,
        outsideTransaction,
        guardCurrentValue: (currentValue) => assertBelowHardCap(currentValue + amount - 1, cap),
      });
      if (!reserved.isSuccess) throw reraiseAsKumikoError(reserved.error);

      let result: WriteResult;
      try {
        result = await handler.handler(event, ctx);
      } catch (error) {
        await releaseReservationBestEffort(ctx, cap, amount, outsideTransaction);
        throw error;
      }
      if (!result.isSuccess) {
        await releaseReservationBestEffort(ctx, cap, amount, outsideTransaction);
      }

      return result;
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
