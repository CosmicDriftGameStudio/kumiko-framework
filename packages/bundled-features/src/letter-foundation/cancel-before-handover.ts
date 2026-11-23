import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { LETTER_ENTITY, LETTER_STATE, LetterInternalHandlers } from "./constants.ts";
import { letterExecutor, letterSubmissionTable } from "./entity.ts";
import { findClaim, releaseReservationAfterCommit } from "./letter-usage.ts";
import { transitionLetter } from "./transitions.ts";

export function isCancelableBeforeHandover(
  status: unknown,
): status is typeof LETTER_STATE.awaitingApproval | typeof LETTER_STATE.approved {
  return status === LETTER_STATE.awaitingApproval || status === LETTER_STATE.approved;
}

/** Cancels a letter that waits for approval or is approved, without a role check: the caller decides who may.
 *  Any other state ends with `canceled: false`, so a caller can drop letters of a superseded case blindly.
 *  Call it inside the handler's transaction. */
export async function cancelBeforeHandoverInFeature(
  ctx: HandlerContext,
  user: SessionUser,
  letterId: string,
): Promise<WriteResult<{ readonly canceled: boolean }>> {
  const letter = await letterExecutor.detail({ id: letterId }, user, ctx.db);
  if (letter === null) return failNotFound(LETTER_ENTITY, letterId);
  if (!isCancelableBeforeHandover(letter.status)) {
    return { isSuccess: true, data: { canceled: false } };
  }
  const moved = await transitionLetter(ctx, user, {
    letterId: letter.id,
    from: letter.status,
    to: LETTER_STATE.canceled,
  });
  if (!moved.isSuccess) return moved;
  // A handover run that stopped after taking its reservation leaves the letter in `approved` with a claim.
  const claim = await findClaim(ctx.db, letter.id);
  if (claim !== undefined) {
    releaseReservationAfterCommit(ctx, claim);
    await ctx.db.deleteMany(letterSubmissionTable, { id: claim.id });
  }
  return { isSuccess: true, data: { canceled: true } };
}

/** For another feature's write handler: cancels a waiting or approved letter in the caller's transaction,
 *  without asking for the `LetterApprover` role. Any other state ends with `canceled: false`. */
export async function cancelLetterBeforeHandover(
  ctx: Pick<HandlerContext, "dispatch">,
  letterId: string,
): Promise<WriteResult<{ readonly canceled: boolean }>> {
  const result = await ctx.dispatch.write(LetterInternalHandlers.cancelBeforeHandover, {
    letterId,
  });
  if (!result.isSuccess) return result;
  return { isSuccess: true, data: { canceled: propertyOf(result.data, "canceled") === true } };
}
