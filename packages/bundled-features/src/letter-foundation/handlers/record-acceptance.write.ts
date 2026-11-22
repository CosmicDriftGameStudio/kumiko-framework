import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { acceptLetter } from "../accept-letter.ts";
import { letterExecutor } from "../entity.ts";
import { RecordAcceptanceSchema } from "../payloads.ts";
import { internalAccess, NOT_APPLIED } from "./internal-shared.ts";

export const recordAcceptanceHandler = defineWriteHandler({
  name: "record-acceptance",
  schema: RecordAcceptanceSchema,
  access: internalAccess,
  agent: { expose: false },
  description:
    "Internal: records that the provider accepted the letter with its actual price, and books the cost, piece, sheet and page counters in the same transaction.",
  handler: async (event, ctx) => {
    const letter = await letterExecutor.detail({ id: event.payload.letterId }, event.user, ctx.db);
    if (letter === null) return NOT_APPLIED;
    return acceptLetter(ctx, event.user, letter, event.payload);
  },
});
