import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { readCalendarCapCounter } from "../book-cap-usage.ts";

// get-counter — return the tenant-wide counter of (calling tenant, capName, periodStartIso).
// Returns null if no booking has happened in this period yet — caller treats that as
// "value = 0, no warning flagged".
const getCounterSchema = z.object({
  capName: z.string().min(1).max(100),
  periodStartIso: z.iso.datetime({ offset: true }),
});

export const getCounterQuery: QueryHandlerDef = {
  name: "get-counter",
  description:
    "Returns the calendar-period usage counter of the caller's tenant for one cap name and period start, or null when nothing was counted yet; use it to show remaining quota.",
  schema: getCounterSchema,
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const payload = query.payload as z.infer<typeof getCounterSchema>; // @cast-boundary engine-payload
    const counter = await readCalendarCapCounter(ctx.db, ctx.user.tenantId, payload);
    if (!counter) return null;
    return {
      capName: payload.capName,
      periodStartIso: payload.periodStartIso,
      value: counter.value,
      lastSoftWarnedAt: counter.lastSoftWarnedAt,
    };
  },
};
