import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  bookCapUsage,
  currentCalendarMonthStartIso,
  releaseCapUsage,
} from "../cap-counter/index.ts";
import { unprocessable } from "../shared/index.ts";
import { LETTER_STATE, LetterErrors, LetterI18n, type LetterState } from "./constants.ts";
import { type LetterRow, letterSubmissionTable } from "./entity.ts";
import {
  applyAcceptedUsage,
  findClaim,
  releaseBookedEstimate,
  releaseReservationAfterCommit,
} from "./letter-usage.ts";
import type { RecordAcceptance } from "./payloads.ts";
import { isLetterState } from "./row-guards.ts";
import { transitionLetter } from "./transitions.ts";

type AcceptableFrom = typeof LETTER_STATE.submitting | typeof LETTER_STATE.submissionUnknown;
type AtProviderState = typeof LETTER_STATE.accepted | typeof LETTER_STATE.onHold;

export function isAcceptableState(status: unknown): status is AcceptableFrom {
  return status === LETTER_STATE.submitting || status === LETTER_STATE.submissionUnknown;
}

export function isAtProviderState(status: unknown): status is AtProviderState {
  return status === LETTER_STATE.accepted || status === LETTER_STATE.onHold;
}

export function stateOf(letter: LetterRow): LetterState | undefined {
  return isLetterState(letter.status) ? letter.status : undefined;
}

/**
 * The one acceptance path, used by the handover job and by the poll that resolves an unknown
 * handover. One transaction: the state change, the price settlement, the piece, sheet and page
 * counters and the claim. The state guard in `transitionLetter` keeps a repeated call from booking twice.
 */
export async function acceptLetter(
  ctx: HandlerContext,
  user: SessionUser,
  letter: LetterRow,
  acceptance: RecordAcceptance,
): Promise<WriteResult<{ readonly applied: boolean }>> {
  const from = letter.status;
  if (!isAcceptableState(from)) return { isSuccess: true, data: { applied: false } };
  const moved = await transitionLetter(ctx, user, {
    letterId: letter.id,
    from,
    to: LETTER_STATE.accepted,
    changes: {
      providerJobId: acceptance.providerJobId,
      actualNet: acceptance.actualNet,
      actualVat: acceptance.actualVat,
      ...(acceptance.recognizedAddress !== undefined && {
        recognizedAddress: acceptance.recognizedAddress,
      }),
      ...(acceptance.cancelableUntil !== undefined && {
        cancelableUntil: Temporal.Instant.from(acceptance.cancelableUntil),
      }),
      ...(acceptance.trackingNumber !== undefined && { trackingNumber: acceptance.trackingNumber }),
    },
  });
  if (!moved.isSuccess) return { isSuccess: true, data: { applied: false } };
  const claim = await findClaim(ctx.db, letter.id);
  // The month is only known from the claim; without it the acceptance still books, into the current month.
  if (claim?.periodStart == null) {
    ctx.obs.log.error(
      "[letter-foundation] accepted letter has no claim period, booking into the current month",
      {
        letterId: letter.id,
      },
    );
  }
  const periodStart = claim?.periodStart ?? currentCalendarMonthStartIso(ctx.tz.now());
  // An unknown handover already counts its estimate; the actual price replaces it instead of adding to it.
  if (claim !== undefined) {
    await releaseBookedEstimate(ctx, claim, letter.quotedNet?.amount ?? 0, false);
  }
  await applyAcceptedUsage(ctx, letter, periodStart, acceptance.actualNet.amount, bookCapUsage);
  if (claim !== undefined) {
    releaseReservationAfterCommit(ctx, claim);
    await ctx.db.updateMany(
      letterSubmissionTable,
      { status: "submitted", providerJobId: acceptance.providerJobId },
      { id: claim.id },
    );
  }
  return { isSuccess: true, data: { applied: true } };
}

/** A letter at the provider ends as failed or canceled: the transition and the counters going back share one transaction. */
export async function leaveProviderQueue(
  ctx: HandlerContext,
  user: SessionUser,
  letter: LetterRow,
  to: typeof LETTER_STATE.failed | typeof LETTER_STATE.canceled,
  changes: Readonly<Record<string, unknown>> = {},
): Promise<WriteResult<{ readonly letterId: string; readonly status: LetterState }>> {
  const from = letter.status;
  if (!isAtProviderState(from)) {
    return unprocessable(LetterErrors.stateChanged, LetterI18n.stateChanged);
  }
  const moved = await transitionLetter(ctx, user, { letterId: letter.id, from, to, changes });
  if (!moved.isSuccess) return moved;
  const claim = await findClaim(ctx.db, letter.id);
  if (claim?.periodStart == null) {
    // Without the month there is nothing safe to book back into; the state change stands.
    ctx.obs.log.error(
      "[letter-foundation] letter left the provider queue without a claim period, counters not given back",
      { letterId: letter.id },
    );
    return moved;
  }
  await applyAcceptedUsage(
    ctx,
    letter,
    claim.periodStart,
    letter.actualNet?.amount ?? 0,
    releaseCapUsage,
  );
  // Nothing can be given back any more, so the claim has done its job.
  await ctx.db.deleteMany(letterSubmissionTable, { id: claim.id });
  return moved;
}
