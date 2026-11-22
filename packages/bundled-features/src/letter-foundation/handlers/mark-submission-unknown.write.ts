import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { LETTER_STATE } from "../constants.ts";
import { letterExecutor } from "../entity.ts";
import { bookEstimateForUnknownHandover, findClaim } from "../letter-usage.ts";
import { LetterIdSchema } from "../payloads.ts";
import { transitionLetter } from "../transitions.ts";
import { APPLIED, internalAccess, NOT_APPLIED } from "./internal-shared.ts";

export const markSubmissionUnknownHandler = defineWriteHandler({
  name: "mark-submission-unknown",
  schema: LetterIdSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: marks a letter whose handover ended without an answer and turns its estimated price into a firm booking against the monthly limit, which stays until the outcome is known.",
  handler: async (event, ctx) => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter === null) return NOT_APPLIED;
    const moved = await transitionLetter(ctx, event.user, {
      letterId: letter.id,
      from: LETTER_STATE.submitting,
      to: LETTER_STATE.submissionUnknown,
    });
    if (!moved.isSuccess) return NOT_APPLIED;
    const claim = await findClaim(ctx.db, letter.id);
    if (claim !== undefined) {
      await bookEstimateForUnknownHandover(ctx, claim, letter.quotedNet?.amount ?? 0);
    }
    return APPLIED;
  },
});
