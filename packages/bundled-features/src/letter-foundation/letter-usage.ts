import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { reraiseAsKumikoError } from "@cosmicdrift/kumiko-framework/errors";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import {
  bookCapUsage,
  calendarCapReservationHandle,
  calendarMonthPeriodEndIso,
  releaseCapUsage,
  reserveCalendarCapUsage,
} from "../cap-counter/index.ts";
import { LETTER_CAP, LETTER_CLAIM_STATUS, type LetterShippingMode } from "./constants.ts";
import { letterSubmissionTable } from "./entity.ts";
import { isLetterShippingMode } from "./row-guards.ts";

type CapCtx = Parameters<typeof bookCapUsage>[0];

export type LetterClaim = {
  readonly id: string;
  readonly letterId: string;
  readonly status: string;
  readonly reservationId: string | null;
  readonly periodStart: string | null;
};

type UsageLetter = {
  readonly shippingMode: unknown;
  readonly pageCount: number | null;
  readonly sheetCount: number | null;
};

type Counter = { readonly capName: string; readonly amount: number };

function unitCounters(letter: UsageLetter): readonly Counter[] {
  const mode: LetterShippingMode | undefined = isLetterShippingMode(letter.shippingMode)
    ? letter.shippingMode
    : undefined;
  if (mode === undefined) throw new Error("letter-foundation: letter has no valid shipping mode");
  return [
    { capName: LETTER_CAP.count(mode), amount: 1 },
    { capName: LETTER_CAP.sheets(mode), amount: letter.sheetCount ?? 0 },
    { capName: LETTER_CAP.pages, amount: letter.pageCount ?? 0 },
  ].filter((counter) => counter.amount > 0);
}

/** Reserves the previewed price against the monthly limit; throws CapExceededError when it does not fit. */
export function reserveLetterCost(
  ctx: CapCtx,
  args: { readonly quotedCents: number; readonly limitCents: number; readonly periodStart: string },
) {
  return reserveCalendarCapUsage(ctx, {
    capName: LETTER_CAP.costNetCents,
    amount: args.quotedCents,
    limit: args.limitCents,
    periodStartIso: args.periodStart,
    periodEndIso: calendarMonthPeriodEndIso(args.periodStart),
    profile: "hardSlot",
  });
}

function assertBooked(result: WriteResult<unknown>): void {
  if (!result.isSuccess) throw reraiseAsKumikoError(result.error);
}

/** Books (inside the transaction that sets `accepted`) or gives back (inside the one that leaves the provider's
 *  queue) the actual price and piece, sheets and pages. The reserved estimate is given back after the commit
 *  (see `releaseReservationAfterCommit`), because reservation calls open their own transaction; until then
 *  the month is counted too high, never too low. */
export async function applyAcceptedUsage(
  ctx: HandlerContext,
  letter: UsageLetter,
  periodStart: string,
  actualNetCents: number,
  operation: typeof bookCapUsage | typeof releaseCapUsage,
): Promise<void> {
  const counters: readonly Counter[] = [
    { capName: LETTER_CAP.costNetCents, amount: actualNetCents },
    ...unitCounters(letter),
  ];
  for (const counter of counters) {
    if (counter.amount <= 0) continue;
    assertBooked(
      await operation(ctx, { ...counter, periodStartIso: periodStart, outsideTransaction: false }),
    );
  }
}

/** Gives back a reservation that never became a booking (rejected, resolved by hand). */
export async function releaseReservedCost(
  ctx: CapCtx,
  claim: LetterClaim,
  outsideTransaction: boolean,
): Promise<void> {
  if (claim.reservationId === null || claim.periodStart === null) return;
  await calendarCapReservationHandle(ctx, claim.reservationId, {
    capName: LETTER_CAP.costNetCents,
    periodStartIso: claim.periodStart,
    outsideTransaction,
  }).release();
}

export async function findClaim(
  db: Pick<HandlerContext["db"], "fetchOne">,
  letterId: string,
): Promise<LetterClaim | undefined> {
  return db.fetchOne<LetterClaim>(letterSubmissionTable, { letterId });
}

/** A reservation can only be given back outside the handler's transaction; a reservation that is
 *  lost on a crash in between is returned by the cap-counter's expiry sweep. */
export function releaseReservationAfterCommit(ctx: HandlerContext, claim: LetterClaim): void {
  if (claim.reservationId === null) return;
  ctx.lifecycle.afterCommit?.(() => releaseReservedCost(ctx, claim, true));
}

/** A letter whose handover got no answer keeps its estimate as a firm booking: a reservation expires
 *  after an hour, but the letter may still be at the provider and cost money. Booking it and giving the
 *  reservation back after the commit leaves the estimate counted once. */
export async function bookEstimateForUnknownHandover(
  ctx: HandlerContext,
  claim: LetterClaim,
  quotedCents: number,
): Promise<void> {
  if (claim.periodStart === null || quotedCents <= 0) return;
  assertBooked(
    await bookCapUsage(ctx, {
      capName: LETTER_CAP.costNetCents,
      amount: quotedCents,
      periodStartIso: claim.periodStart,
      outsideTransaction: false,
    }),
  );
  releaseReservationAfterCommit(ctx, claim);
  await ctx.db.updateMany(
    letterSubmissionTable,
    { status: LETTER_CLAIM_STATUS.estimateBooked, reservationId: null },
    { id: claim.id },
  );
}

/** Gives the booked estimate of an unknown handover back, because the letter ends up booked at its
 *  actual price or not at all. A no-op for every other claim. */
export async function releaseBookedEstimate(
  ctx: CapCtx,
  claim: LetterClaim,
  quotedCents: number,
  outsideTransaction: boolean,
): Promise<void> {
  if (claim.status !== LETTER_CLAIM_STATUS.estimateBooked) return;
  if (claim.periodStart === null || quotedCents <= 0) return;
  assertBooked(
    await releaseCapUsage(ctx, {
      capName: LETTER_CAP.costNetCents,
      amount: quotedCents,
      periodStartIso: claim.periodStart,
      outsideTransaction,
    }),
  );
}
