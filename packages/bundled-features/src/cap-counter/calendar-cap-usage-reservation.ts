import type { CapCounterContext } from "./book-cap-usage.js";
import {
  type CalendarCapReservation,
  releaseExpiredCapReservations,
  reserveCalendarCap,
  settleCalendarCapReservation,
} from "./cap-reservation.js";
import {
  assertBelowHardCap,
  enforceCapAndMaybeNotify,
  type SoftHitNotifier,
} from "./enforce-cap.js";
import type { CalendarCapDef } from "./with-cap-enforcement.js";

export type CalendarCapUsageReservationSpec = Omit<CalendarCapDef, "amount" | "notify"> & {
  readonly amount: number;
  readonly notify?: SoftHitNotifier;
  // Default true: the reservation must commit on its own, not roll back with the caller's transaction.
  readonly outsideTransaction?: boolean;
};

export type CalendarCapUsageReservation = {
  readonly amount: number;
  // Counter value right after this reservation was booked.
  readonly counterValue: number;
  // Replaces the reserved amount with the actual one; rejects a second settle and one after release.
  settle(actualAmount: number): Promise<void>;
  // Gives the reserved amount back; a no-op once settled.
  release(): Promise<void>;
};

// Shared by withCapEnforcement and the public reservation API so both enforce identically.
export async function reserveEnforcedCalendarCap(
  ctx: CapCounterContext,
  cap: CalendarCapUsageReservationSpec,
): Promise<CalendarCapReservation> {
  const outsideTransaction = cap.outsideTransaction ?? true;
  await releaseExpiredCapReservations(ctx, cap.capName, outsideTransaction);
  if (cap.notify) {
    await enforceCapAndMaybeNotify(ctx, {
      capName: cap.capName,
      periodStartIso: cap.periodStartIso,
      limit: cap.limit,
      profile: cap.profile,
      notify: cap.notify,
      amount: cap.amount,
      markSoftWarnedOutsideTransaction: outsideTransaction,
    });
  }
  return reserveCalendarCap(
    ctx,
    {
      capName: cap.capName,
      amount: cap.amount,
      periodStartIso: cap.periodStartIso,
      guardCurrentValue: (currentValue) => assertBelowHardCap(currentValue + cap.amount - 1, cap),
    },
    outsideTransaction,
  );
}

type ReservationState = "open" | "settled" | "released";

export async function reserveCalendarCapUsage(
  ctx: CapCounterContext,
  spec: CalendarCapUsageReservationSpec,
): Promise<CalendarCapUsageReservation> {
  const outsideTransaction = spec.outsideTransaction ?? true;
  const reservation = await reserveEnforcedCalendarCap(ctx, spec);
  let state: ReservationState = "open";

  return {
    amount: spec.amount,
    counterValue: reservation.counterValue,
    async settle(actualAmount) {
      if (state !== "open") {
        throw new Error(`cap-counter: reservation for "${spec.capName}" is already ${state}`);
      }
      state = "settled";
      try {
        await settleCalendarCapReservation(
          ctx,
          reservation.reservationId,
          { capName: spec.capName, periodStartIso: spec.periodStartIso, actualAmount },
          outsideTransaction,
        );
      } catch (error) {
        state = "open";
        throw error;
      }
    },
    async release() {
      // skip: release after settle, or a second release, is a no-op by contract.
      if (state !== "open") return;
      await reservation.release();
      state = "released";
    },
  };
}
