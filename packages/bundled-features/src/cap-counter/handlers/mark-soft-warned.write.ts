import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { markCapSoftWarned } from "../book-cap-usage.ts";

// mark-soft-warned — sets lastSoftWarnedAt on the counter so subsequent
// soft-cap-hits in the same period don't re-trigger notifications.
// This prevents notification storms.
//
// **Caller pattern:** enforceCap-Helper checks whether the value crosses the
// soft threshold while lastSoftWarnedAt is null, then calls this handler and
// emits the application-specific notification. This handler only sets the flag.
const markSoftWarnedSchema = z.object({
  capName: z.string().min(1).max(100),
  periodStartIso: z.string().min(1),
});

export const markSoftWarnedHandler: WriteHandlerDef = {
  name: "mark-soft-warned",
  agent: { expose: false },
  schema: markSoftWarnedSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as z.infer<typeof markSoftWarnedSchema>; // @cast-boundary engine-payload
    return markCapSoftWarned(ctx, {
      capName: payload.capName,
      periodStartIso: payload.periodStartIso,
    });
  },
};
