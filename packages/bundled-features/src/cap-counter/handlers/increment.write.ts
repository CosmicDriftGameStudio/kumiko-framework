import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { bookCapUsage } from "../book-cap-usage";

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

// increment-cap — atomic counter increment via the event-store's
// optimistic-lock. Two parallel increments for the same (tenant, cap,
// period) go to the same aggregate; the second one's append fails with
// version_conflict — caller retries (the dispatcher already handles
// that for write-handlers, see version_conflict-retry-policy).
//
// **Two paths:**
//   1. Aggregate doesn't exist yet (first increment of the period) →
//      executor.create with deterministic id, value = amount.
//   2. Aggregate exists → executor.update with current value + amount.
//
// **Why no `r.systemScope`:** counters are tenant-scoped (one row per
// tenant per cap per period). The dispatcher's tenant-filter on ctx.db
// ensures a tenant can only see/increment their own counters. Cross-
// tenant cap-rebuild for ops uses raw DB-access at the framework layer,
// not this handler.
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
    return bookCapUsage(ctx, {
      capName: payload.capName,
      periodStartIso: payload.periodStartIso,
      amount: payload.amount,
    });
  },
};
