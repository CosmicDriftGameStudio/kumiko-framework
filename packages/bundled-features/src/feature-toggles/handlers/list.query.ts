import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { FEATURE_TOGGLE_CROSS_TENANT_REASON } from "../constants";
import { globalFeatureStateTable } from "../global-feature-state-table";

// List every row in the global_feature_state table — i.e. every feature
// that has ever been explicitly flipped. Features without a row aren't
// returned; callers must combine this with `registered` to see the full
// effective state (registered features + their current override, if any).
export const listQuery = defineQueryHandler({
  name: "list",
  schema: z.object({}),
  access: { roles: ["SystemAdmin"] },
  handler: async (_event, ctx) => {
    // ctx.systemDb is populated for r.systemScope() handlers only (feature.ts
    // declares it) — guarded instead of asserted, see set.write.ts Guard 0.5.
    if (!ctx.systemDb) {
      throw new Error(
        "[feature-toggles] list-query requires ctx.systemDb — the feature-toggles " +
          "feature must stay r.systemScope() (see feature.ts).",
      );
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(FEATURE_TOGGLE_CROSS_TENANT_REASON);

    type Row = {
      featureName: string;
      enabled: boolean;
      version: number;
      updatedAt: Temporal.Instant;
      updatedBy: string;
    };
    const rows = await selectMany<Row>(db.raw, globalFeatureStateTable);
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
