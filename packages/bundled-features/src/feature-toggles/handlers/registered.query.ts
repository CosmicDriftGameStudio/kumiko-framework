import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { globalFeatureStateTable } from "../global-feature-state-table";

// Inventory of every registered feature, annotated with toggle metadata
// and the current effective state. This is the canonical "what's here,
// what's on, what depends on what" snapshot — the UI for the operator
// toggle screen binds to it.
//
// Design: registry introspection (toggleable/default/requires) + a single
// DB read of overrides. No per-feature DB calls. Scales to however many
// features an app registers — currently tens, never thousands.
export const registeredQuery = defineQueryHandler({
  name: "registered",
  schema: z.object({}),
  access: { roles: ["SystemAdmin", "Admin"] },
  handler: async (_event, ctx) => {
    type OverrideRow = Pick<typeof globalFeatureStateTable.$inferSelect, "featureName" | "enabled">;
    const overrideRows = (await ctx.db
      .select({
        featureName: globalFeatureStateTable.featureName,
        enabled: globalFeatureStateTable.enabled,
      })
      .from(globalFeatureStateTable)) as OverrideRow[];
    const overrides = new Map(overrideRows.map((r) => [r.featureName, r.enabled]));

    const effective = ctx.effectiveFeatures?.();

    const items = [];
    for (const feature of ctx.registry.features.values()) {
      const toggleable = feature.toggleableDefault !== undefined;
      const override = overrides.get(feature.name);
      items.push({
        name: feature.name,
        toggleable,
        // `default` is null when non-toggleable; the UI must render
        // non-toggleable features as "always on" without an enable/disable
        // control (flipping them would be rejected by the set-handler).
        default: feature.toggleableDefault ?? null,
        // `override` is null when no explicit row exists. That's distinct
        // from "override says on" or "override says off" so the UI can show
        // an "inherits default" indicator.
        override: override ?? null,
        requires: feature.requires,
        // Effective = what the dispatcher-gate actually uses right now,
        // after cascade. When the feature-toggles runtime isn't wired
        // (dev setup without the feature loaded), we surface null so the
        // UI knows the runtime isn't available rather than defaulting
        // to "everything on".
        effective: effective ? effective.has(feature.name) : null,
      });
    }

    return { items };
  },
});
