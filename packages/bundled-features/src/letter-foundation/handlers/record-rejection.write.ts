import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { isAcceptableState, stateOf } from "../accept-letter.ts";
import { LETTER_STATE } from "../constants.ts";
import { letterExecutor } from "../entity.ts";
import { RecordRejectionSchema } from "../payloads.ts";
import { transitionLetter } from "../transitions.ts";
import { APPLIED, internalAccess, NOT_APPLIED } from "./internal-shared.ts";

export const recordRejectionHandler = defineWriteHandler({
  name: "record-rejection",
  schema: RecordRejectionSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: marks a letter failed that the provider rejected or that the monthly limit stopped before the handover.",
  handler: async (event, ctx) => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    const from = letter === null ? undefined : stateOf(letter);
    // approved: the monthly limit stops a letter before it ever reaches submitting
    const rejectable = from === LETTER_STATE.approved || isAcceptableState(from);
    if (letter === null || from === undefined || !rejectable) return NOT_APPLIED;
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
    return moved.isSuccess ? APPLIED : NOT_APPLIED;
  },
});
