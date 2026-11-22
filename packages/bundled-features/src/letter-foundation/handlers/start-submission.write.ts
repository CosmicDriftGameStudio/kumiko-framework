import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { LETTER_STATE } from "../constants.ts";
import { LetterIdSchema } from "../payloads.ts";
import { transitionLetter } from "../transitions.ts";
import { APPLIED, internalAccess, NOT_APPLIED } from "./internal-shared.ts";

// The writes of the handover and poll jobs run as handlers because a job may only append its
// own events through ctx.events, and every state change must share its transaction with the counter booking.
export const startSubmissionHandler = defineWriteHandler({
  name: "start-submission",
  schema: LetterIdSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: moves an approved letter to submitting so the handover job owns it; a letter canceled in the meantime stays canceled.",
  handler: async (event, ctx): Promise<WriteResult<{ readonly applied: boolean }>> => {
    const moved = await transitionLetter(ctx, event.user, {
      letterId: event.payload.letterId,
      from: LETTER_STATE.approved,
      to: LETTER_STATE.submitting,
    });
    return moved.isSuccess ? APPLIED : NOT_APPLIED;
  },
});
