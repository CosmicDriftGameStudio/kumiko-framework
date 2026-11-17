import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { markCapSoftWarned } from "../book-cap-usage.ts";

// mark-soft-warned — sets lastSoftWarnedAt on the counter so subsequent
// soft-cap-hits in the same period don't re-trigger notifications.
// This prevents notification storms. Creates the counter row when it does not exist yet and
// answers `marked: true` only for the call that set the flag.
//
// **Caller pattern:** enforceCapAndMaybeNotify marks first and notifies only when it got `true`.
const markSoftWarnedSchema = z.object({
  capName: z.string().min(1).max(100),
  periodStartIso: z.iso.datetime({ offset: true }),
});

export const markSoftWarnedHandler = defineWriteHandler({
  name: "mark-soft-warned",
  agent: { expose: false },
  schema: markSoftWarnedSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload;
    return {
      isSuccess: true as const,
      data: {
        marked: await markCapSoftWarned(ctx, {
          capName: payload.capName,
          periodStartIso: payload.periodStartIso,
        }),
      },
    };
  },
});
