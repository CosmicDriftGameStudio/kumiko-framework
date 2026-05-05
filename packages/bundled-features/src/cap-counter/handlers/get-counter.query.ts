import { createEntityExecutor, type QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { capCounterEntity } from "../entity";

const { table } = createEntityExecutor("cap-counter", capCounterEntity);

// get-counter — return the current counter row for (calling tenant,
// capName, periodStartIso). Returns null if no increment has happened
// in this period yet — caller treats that as "value = 0, no warning
// flagged".
//
// **Composition:** enforceCap-helper consumes this. UIs that show
// remaining-quota call it directly.
const getCounterSchema = z.object({
  capName: z.string().min(1).max(100),
  periodStartIso: z.string().min(1),
});

export const getCounterQuery: QueryHandlerDef = {
  name: "get-counter",
  schema: getCounterSchema,
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const { capName, periodStartIso } = query.payload as z.infer<typeof getCounterSchema>;

    // ctx.db is tenant-scoped; filter by capName + periodStart explicitly.
    const rows = await ctx.db
      .select()
      .from(table)
      .where(
        and(
          eq(table["capName"], capName),
          // periodStart is stored as Temporal.Instant; compare against
          // the iso string directly (timestamptz-column round-trips).
          eq(table["periodStart"], periodStartIso),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  },
};
