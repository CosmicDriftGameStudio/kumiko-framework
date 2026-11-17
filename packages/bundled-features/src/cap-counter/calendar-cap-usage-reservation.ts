import type { CapCounterContext } from "./book-cap-usage.ts";
import {
  type CalendarCapReservation,
  consumeCalendarCapReservation,
  releaseCapReservation,
  releaseExpiredCapReservations,
  reserveCalendarCap,
  settleCalendarCapReservation,
} from "./cap-reservation.ts";
import { capSubjectLimit, capSubjectSchema } from "./cap-subject.ts";
import {
  assertBelowHardCap,
  enforceCapAndMaybeNotify,
  type SoftHitNotifier,
} from "./enforce-cap.ts";
import type { CalendarCapDef } from "./with-cap-enforcement.ts";

export type CalendarCapUsageReservationSpec = Omit<CalendarCapDef, "amount" | "notify"> & {
  readonly amount: number;
  readonly notify?: SoftHitNotifier;
  // Default true: the reservation must commit on its own, not roll back with the caller's transaction.
  readonly outsideTransaction?: boolean;
};

export type CalendarCapUsageReservation = {
  readonly reservationId: string;
  readonly amount: number;
  // Counter value right after this reservation was booked.
  readonly counterValue: number;
  // Replaces the reserved amount with the actual one; rejects a second settle and one after release.
  // actualAmount is the total used, including units consumed through a handle.
  settle(actualAmount: number): Promise<void>;
  // Gives the reserved amount back; a no-op once settled.
  release(): Promise<void>;
};

// Shared by withCapEnforcement and the public reservation API so both enforce identically.
export async function reserveEnforcedCalendarCap(
  ctx: CapCounterContext,
  cap: CalendarCapUsageReservationSpec,
): Promise<CalendarCapReservation> {
  const subject = cap.subject && capSubjectSchema.parse(cap.subject);
  const share = subject?.share;
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
      ...(cap.periodEndIso !== undefined && { periodEndIso: cap.periodEndIso }),
      ...(cap.i18nKey !== undefined && { i18nKey: cap.i18nKey }),
      markSoftWarnedOutsideTransaction: outsideTransaction,
      ...(subject !== undefined && { subject }),
    });
  }
  return reserveCalendarCap(
    ctx,
    {
      capName: cap.capName,
      amount: cap.amount,
      periodStartIso: cap.periodStartIso,
      ...(subject !== undefined && { subjectKey: subject.key }),
      guardTenantValue: (before) => assertBelowHardCap(before + cap.amount - 1, cap),
      ...(share !== undefined && {
        guardSubjectValue: (before: number) =>
          assertBelowHardCap(
            before + cap.amount - 1,
            { ...cap, limit: capSubjectLimit(cap.limit, share) },
            "subject",
          ),
      }),
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
    reservationId: reservation.reservationId,
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
          {
            capName: spec.capName,
            periodStartIso: spec.periodStartIso,
            actualAmount,
            ...(spec.subject !== undefined && { subjectKey: spec.subject.key }),
          },
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

export type CalendarCapReservationHandleSpec = Pick<
  CalendarCapUsageReservationSpec,
  "capName" | "periodStartIso" | "outsideTransaction" | "subject"
>;

export type CalendarCapReservationHandle = {
  // Moves units from reserved to booked, counter unchanged; rejects more than the still-reserved rest.
  consume(units: number): Promise<void>;
  // Gives back the unconsumed rest; a no-op once settled or already released.
  release(): Promise<void>;
  // Replaces the reservation by the actual amount (books the overflow when actual exceeds it);
  // a repeat after a lost ack books nothing twice, so a caller may retry it.
  settle(actualAmount: number): Promise<void>;
};

// Addresses a reservation by id so a job can consume it per unit; capName and period are needed
// because the row may already be swept, in which case consume books the units directly.
export function calendarCapReservationHandle(
  ctx: CapCounterContext,
  reservationId: string,
  spec: CalendarCapReservationHandleSpec,
): CalendarCapReservationHandle {
  const subject = spec.subject && capSubjectSchema.parse(spec.subject);
  const subjectKeyOption = subject === undefined ? {} : { subjectKey: subject.key };
  const outsideTransaction = spec.outsideTransaction ?? true;
  let released = false;
  return {
    async consume(units) {
      if (released) {
        throw new Error(`cap-counter: reservation for "${spec.capName}" is already released`);
      }
      await consumeCalendarCapReservation(
        ctx,
        reservationId,
        { capName: spec.capName, periodStartIso: spec.periodStartIso, units, ...subjectKeyOption },
        outsideTransaction,
      );
    },
    async release() {
      // skip: release is idempotent, a second call has nothing left to give back
      if (released) return;
      await releaseCapReservation(ctx, reservationId, outsideTransaction);
      released = true;
    },
    async settle(actualAmount) {
      await settleCalendarCapReservation(
        ctx,
        reservationId,
        {
          capName: spec.capName,
          periodStartIso: spec.periodStartIso,
          actualAmount,
          ...subjectKeyOption,
        },
        outsideTransaction,
      );
    },
  };
}
