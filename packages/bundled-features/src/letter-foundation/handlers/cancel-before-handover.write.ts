import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { cancelBeforeHandoverInFeature } from "../cancel-before-handover.ts";
import { LetterIdSchema } from "../payloads.ts";

export const cancelBeforeHandoverHandler = defineWriteHandler({
  name: "cancel-before-handover",
  schema: LetterIdSchema,
  // Not a system-access internal handler: the cancel event keeps the user who changed the record as actor,
  // and the calling feature needs no identity switch.
  dispatchOnly: true,
  access: {
    openToAll: {
      reason:
        "reachable only through ctx.dispatch; the write handler of the calling feature decides who may drop the letters of its record",
    },
  },
  description:
    "Server-only: cancels a letter that waits for approval or is approved, without a role check. Reached through `cancelLetterBeforeHandover`, so another feature can drop the letters of a superseded case.",
  handler: async (event, ctx) =>
    cancelBeforeHandoverInFeature(ctx, event.user, event.payload.letterId),
});
