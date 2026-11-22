import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { isAcceptableState, stateOf } from "../accept-letter.ts";
import { LETTER_FAILURE_REASON, LETTER_STATE, type LetterFailureReason } from "../constants.ts";
import { letterExecutor } from "../entity.ts";
import { closeClaimWithoutBooking } from "../letter-usage.ts";
import { RecordRejectionSchema } from "../payloads.ts";
import { transitionLetter } from "../transitions.ts";
import { APPLIED, internalAccess, NOT_APPLIED } from "./internal-shared.ts";

// A reason only fits the state its failure happens in: the limit and the document stop a letter in
// `approved`, the provider can only reject what it was handed.
function isRejectableFrom(reason: LetterFailureReason, from: unknown): boolean {
  if (reason === LETTER_FAILURE_REASON.monthlyLimit) return from === LETTER_STATE.approved;
  if (reason === LETTER_FAILURE_REASON.documentUnreadable) return from === LETTER_STATE.approved;
  if (reason === LETTER_FAILURE_REASON.providerChanged) return from === LETTER_STATE.approved;
  if (reason === LETTER_FAILURE_REASON.handoverStalled) return from === LETTER_STATE.approved;
  if (reason === LETTER_FAILURE_REASON.rejectedByProvider) return isAcceptableState(from);
  return false;
}

export const recordRejectionHandler = defineWriteHandler({
  name: "record-rejection",
  schema: RecordRejectionSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: marks a letter failed that the provider rejected or that the monthly limit or an unreadable document stopped before the handover, and settles its claim: the reservation and a booked estimate go back and the claim is removed.",
  handler: async (event, ctx) => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    const from = letter === null ? undefined : stateOf(letter);
    if (letter === null || from === undefined) return NOT_APPLIED;
    if (!isRejectableFrom(event.payload.failureReason, from)) return NOT_APPLIED;
    const moved = await transitionLetter(ctx, event.user, {
      letterId: event.payload.letterId,
      from,
      to: LETTER_STATE.failed,
      changes: {
        failureReason: event.payload.failureReason,
        ...(event.payload.failureDetail !== undefined && {
          failureDetail: event.payload.failureDetail,
        }),
      },
    });
    if (!moved.isSuccess) return NOT_APPLIED;
    await closeClaimWithoutBooking(ctx, letter.id, letter.quotedNet?.amount ?? 0);
    return APPLIED;
  },
});
