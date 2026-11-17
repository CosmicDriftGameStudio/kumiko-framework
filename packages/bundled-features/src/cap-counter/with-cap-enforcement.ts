// withCapEnforcement: handler wrapper that puts the pre-call enforceCapAndMaybeNotify and a
// reservation around the wrapped handler.
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
// next reserve of the same cap. Reached through a nested ctx.dispatch.write the cap is not reserved, so the
// dispatcher rejects that call unless the top-level batch reserved the same handler.
//
// The wrapper spreads the wrapped handler and chains its reserveBeforeTransaction: inner reserves
// first, release runs in reverse, and an outer failure gives the inner reservation back.
//
// No automatic markSoftWarned here — that's inside enforceCapAndMaybeNotify
// (enforce-cap.ts).

import type {
  KumikoEventTypeMap,
  ReservationContext,
  WriteEvent,
  WriteHandlerDef,
  WriteHandlerDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { BeforeTransactionWhenNested } from "@cosmicdrift/kumiko-types/handlers";
import type { ZodType } from "zod";
import { reserveEnforcedCalendarCap } from "./calendar-cap-usage-reservation.ts";
import type { CapSubject } from "./cap-subject.ts";
import type { CapToleranceProfileName, SoftHitNotifier } from "./enforce-cap.ts";
import { chainReservations } from "./reservation-chain.ts";

// =============================================================================
// Calendar-Period-Wrapper
// =============================================================================

/**
 * Dynamic cap definition resolved for each handler invocation. A typical caller reads the tenant
 * tier from `ctx` and maps it to a limit. `amount` defaults to 1 (counting events); for byte or
 * token caps, the caller supplies the size from `event.payload`.
 */
export type CalendarCapDef = {
  readonly capName: string;
  readonly periodStartIso: string;
  // Default: end of the calendar month that starts at periodStartIso.
  readonly periodEndIso?: string;
  readonly i18nKey?: string;
  readonly limit: number;
  readonly profile: CapToleranceProfileName;
  /** Increment-amount post-success. Default 1. */
  readonly amount?: number;
  readonly notify: SoftHitNotifier;
  readonly subject?: CapSubject;
};

/** Resolver-fn that the wrapper calls before each handler invocation
 *  to compute the cap-spec for THIS request (e.g. limit derived from
 *  tenant-tier). Sync OR async — async lets the caller fetch the
 *  tier from DB. */
export type CalendarCapResolver = (
  event: WriteEvent,
  ctx: ReservationContext,
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
type WithCapEnforcement = {
  (handler: WriteHandlerDef, capResolver: CalendarCapResolver): WriteHandlerDef;
  <
    TName extends string,
    TSchema extends ZodType,
    TData,
    TPrepared,
    TWhenNested extends BeforeTransactionWhenNested | undefined,
  >(
    handler: WriteHandlerDefinition<
      TName,
      TSchema,
      TData,
      KumikoEventTypeMap,
      TPrepared,
      TWhenNested
    >,
    capResolver: CalendarCapResolver,
  ): WriteHandlerDefinition<TName, TSchema, TData, KumikoEventTypeMap, TPrepared, TWhenNested>;
};

export const withCapEnforcement: WithCapEnforcement = (
  handler: WriteHandlerDef,
  capResolver: CalendarCapResolver,
) => ({
  ...handler,
  reserveBeforeTransaction: chainReservations(
    handler.reserveBeforeTransaction,
    async (event, ctx) => {
      const cap = await capResolver(event, ctx);
      return reserveEnforcedCalendarCap(ctx, { ...cap, amount: cap.amount ?? 1 });
    },
  ),
});
