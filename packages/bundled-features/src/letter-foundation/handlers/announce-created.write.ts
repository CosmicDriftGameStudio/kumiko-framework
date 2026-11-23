import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { LETTER_STATE, LetterEvents } from "../constants.ts";
import { LetterIdSchema } from "../payloads.ts";
import { appendLetterEvent } from "../transitions.ts";
import { APPLIED } from "./internal-shared.ts";

// The event belongs to this feature, so `sendLetter` running in the calling feature cannot append it itself.
export const announceCreatedHandler = defineWriteHandler({
  name: "announce-created",
  schema: LetterIdSchema,
  dispatchOnly: true,
  access: {
    openToAll: {
      reason:
        "reachable only through ctx.dispatch from sendLetter, which runs in the write handler of the calling feature",
    },
  },
  description:
    "Server-only: announces a newly created letter so the preparation job picks it up. Reached through `sendLetter`.",
  handler: async (event, ctx) => {
    await appendLetterEvent(ctx, LetterEvents.created, {
      letterId: event.payload.letterId,
      from: LETTER_STATE.awaitingApproval,
    });
    return APPLIED;
  },
});
