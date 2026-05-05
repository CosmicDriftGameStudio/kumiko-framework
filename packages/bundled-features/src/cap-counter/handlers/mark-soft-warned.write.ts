import { createEntityExecutor, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { capCounterAggregateId } from "../aggregate-id";
import { capCounterEntity } from "../entity";

const { table, executor } = createEntityExecutor("cap-counter", capCounterEntity);

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
  schema: markSoftWarnedSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as z.infer<typeof markSoftWarnedSchema>;
    const aggregateId = capCounterAggregateId(
      event.user.tenantId,
      payload.capName,
      payload.periodStartIso,
    );

    const existing = await ctx.db.select().from(table).where(eq(table["id"], aggregateId)).limit(1);
    if (existing.length === 0) {
      throw new Error(
        `cap-counter: cannot mark-soft-warned, no counter found for tenant=${event.user.tenantId} cap=${payload.capName} period=${payload.periodStartIso}`,
      );
    }
    const row = existing[0];
    if (!row) {
      throw new Error("cap-counter:mark-soft-warned: row vanished between length-check and read");
    }
    const currentVersion = row["version"] as number;

    return executor.update(
      {
        id: aggregateId,
        version: currentVersion,
        changes: { lastSoftWarnedAt: Temporal.Now.instant() },
      },
      event.user,
      ctx.db,
    );
  },
};
