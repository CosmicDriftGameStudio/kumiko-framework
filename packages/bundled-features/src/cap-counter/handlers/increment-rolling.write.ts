// increment-rolling — books usage for rolling-window caps (AI tokens over 7 days, egress over 24
// hours) into hourly bucket rows of store_cap_rolling_usage instead of one event per booking, so a
// read sums at most windowDays x 24 rows per cap. The upsert adds to the bucket atomically, so
// parallel bookings neither collide on the key nor lose an update.

import { sql } from "@cosmicdrift/kumiko-framework/db";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { rollingBucketStart } from "../book-cap-usage.ts";
import { ROLLING_CAP_MAX_WINDOW_DAYS } from "../constants.ts";
import { rollingCapUsageTableMeta } from "../tables.ts";

const incrementRollingSchema = z.object({
  /** App-defined cap-name. e.g. "ai-tokens-7day", "egress-bytes-24h". */
  capName: z.string().min(1).max(100),
  /** Increment-amount. Default 1 (count-events) — pass exact size for byte/token-counters. */
  amount: z.number().int().positive().default(1),
});

export const incrementRollingCapHandler: WriteHandlerDef = {
  name: "increment-rolling",
  agent: { expose: false },
  schema: incrementRollingSchema,
  // Internal handler — a system caller (platform foundations after a
  // successful side effect) invokes it. Tenant end users must never
  // call it directly. The audit row shows which subsystem call site
  // attached the operation.
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const { capName, amount } = incrementRollingSchema.parse(event.payload);
    const now = Temporal.Now.instant();
    const bucketStart = rollingBucketStart(now);
    await ctx.db.upsert(
      rollingCapUsageTableMeta,
      { tenantId: event.user.tenantId, capName, bucketStart, amount },
      {
        conflictTarget: ["tenantId", "capName", "bucketStart"],
        update: { amount: sql`"store_cap_rolling_usage"."amount" + EXCLUDED."amount"` },
      },
    );
    await ctx.db.deleteMany(rollingCapUsageTableMeta, {
      tenantId: event.user.tenantId,
      bucketStart: {
        lt: rollingBucketStart(now.subtract({ hours: ROLLING_CAP_MAX_WINDOW_DAYS * 24 })),
      },
    });
    return { isSuccess: true, data: { capName, amount, bucketStart: bucketStart.toString() } };
  },
};
