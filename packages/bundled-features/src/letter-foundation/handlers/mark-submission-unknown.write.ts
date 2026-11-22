import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { LETTER_STATE } from "../constants.ts";
import { LetterIdSchema } from "../payloads.ts";
import { transitionLetter } from "../transitions.ts";
import { APPLIED, internalAccess, NOT_APPLIED } from "./internal-shared.ts";

export const markSubmissionUnknownHandler = defineWriteHandler({
  name: "mark-submission-unknown",
  schema: LetterIdSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: marks a letter whose handover ended without an answer; the cost reservation stays until the outcome is known.",
  handler: async (event, ctx) => {
    const moved = await transitionLetter(ctx, event.user, {
      letterId: event.payload.letterId,
      from: LETTER_STATE.submitting,
      to: LETTER_STATE.submissionUnknown,
    });
    return moved.isSuccess ? APPLIED : NOT_APPLIED;
  },
});
