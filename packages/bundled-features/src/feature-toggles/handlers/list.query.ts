import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { globalFeatureStateTable } from "../global-feature-state-table";

// List every row in the global_feature_state table — i.e. every feature
// that has ever been explicitly flipped. Features without a row aren't
// returned; callers must combine this with `registered` to see the full
// effective state (registered features + their current override, if any).
export const listQuery = defineQueryHandler({
  name: "list",
  schema: z.object({}),
  access: { roles: ["SystemAdmin", "Admin"] },
  handler: async (_event, ctx) => {
    type Row = typeof globalFeatureStateTable.$inferSelect;
    const rows = (await ctx.db.select().from(globalFeatureStateTable)) as Row[];
    return {
      items: rows.map((r) => ({
        featureName: r.featureName,
        enabled: r.enabled,
        version: r.version,
        updatedAt: r.updatedAt.toString(),
        updatedBy: r.updatedBy,
      })),
    };
  },
});
