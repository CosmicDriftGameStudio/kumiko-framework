import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { LETTER_STATE, LetterEvents } from "../constants.ts";
import { letterExecutor } from "../entity.ts";
import { LetterIdSchema } from "../payloads.ts";
import { appendLetterEvent } from "../transitions.ts";
import { APPLIED, internalAccess, NOT_APPLIED } from "./internal-shared.ts";

export const requestHandoverRestartHandler = defineWriteHandler({
  name: "request-handover-restart",
  schema: LetterIdSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: asks the submit job to hand an approved letter over again. The request is an event, so the restart runs in the same queue as the first handover and never beside it; the letter keeps its state.",
  handler: async (event, ctx) => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter === null || letter.status !== LETTER_STATE.approved) return NOT_APPLIED;
    await appendLetterEvent(ctx, LetterEvents.handoverRestartRequested, {
      letterId: letter.id,
      from: LETTER_STATE.approved,
    });
    return APPLIED;
  },
});
