import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { bookCapUsage } from "../book-cap-usage.ts";

const incrementSchema = z.object({
  /** App-defined cap-name. e.g. "platform-mails", "ai-tokens-7day". */
  capName: z.string().min(1).max(100),
  /** Increment-amount. Default 1 (count-events) — pass exact size for
   *  byte/token-counters (file-upload size, llm-token-count). */
  amount: z.number().int().positive().default(1),
  /** Period-start ISO. Caller is responsible: monthly counters use
   *  "first-of-current-month" (computed once per request via
   *  `Temporal.Now.zonedDateTimeISO("UTC").startOfMonth().toString()`),
   *  rolling-window counters pass a fixed sentinel ("1970-01-01"). */
  periodStartIso: z.string().min(1),
});
type IncrementPayload = z.infer<typeof incrementSchema>;

// increment-cap — one atomic upsert increment on the counter row of (tenant, cap, period); parallel
// bookings serialize on the row lock, so no retry loop is needed.
//
// **Why no `r.systemScope`:** counters are tenant-scoped (one row per tenant per cap per period).
// The dispatcher's tenant-filter on ctx.db ensures a tenant can only see/increment their own
// counters.
export const incrementCapHandler: WriteHandlerDef = {
  name: "increment",
  agent: { expose: false },
  schema: incrementSchema,
  // Internal handler — only system-callers (Plattform-foundations after
  // a successful side-effect) drive this. Tenant-end-users never call
  // it directly. SystemAdmin-access leaves a clear audit row showing
  // which subsystem incremented.
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as IncrementPayload; // @cast-boundary engine-payload
    const { value } = await bookCapUsage(ctx, {
      capName: payload.capName,
      periodStartIso: payload.periodStartIso,
      amount: payload.amount,
    });
    return { isSuccess: true as const, data: { value } };
  },
};
