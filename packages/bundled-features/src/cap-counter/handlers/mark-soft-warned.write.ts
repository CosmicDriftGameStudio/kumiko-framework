import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { markCapSoftWarned } from "../book-cap-usage";

// mark-soft-warned — sets lastSoftWarnedAt on the counter so subsequent
// soft-cap-hits in the same period don't re-trigger notifications.
// Anti-Notification-Storm-Schutz aus Memory `project_pricing_byok_caps`.
//
// **Caller-Pattern:** enforceCap-Helper checks if value crosses the
// soft threshold AND lastSoftWarnedAt is null → calls this handler →
// emits whatever notification (delivery-feature, ops-alert, etc.). The
// emit-side is app-specific; this handler only sets the flag.
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
