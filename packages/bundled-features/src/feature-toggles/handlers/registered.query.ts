import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { globalFeatureStateTable } from "../global-feature-state-table.ts";
import { FEATURE_TOGGLE_CROSS_TENANT_REASON } from "../web/constants.ts";

// Inventory of every registered feature, annotated with toggle metadata
// and the current effective state. This is the canonical "what's here,
// what's on, what depends on what" snapshot — the UI for the operator
// toggle screen binds to it.
//
// Design: registry introspection (toggleable/default/requires) + a single
// DB read of overrides. No per-feature DB calls. Scales to however many
// features an app registers — currently tens, never thousands.

function formatFlag(value: boolean | null): string {
  if (value === null) return "inherit";
  return value ? "on" : "off";
}

export const registeredQuery = defineQueryHandler({
  name: "registered",
  description:
    "Lists every registered feature with whether it is toggleable, its default, its explicit override, its dependencies and its effective on/off state; use it as the full feature inventory.",
  schema: z.object({}),
  access: { roles: ["SystemAdmin"] },
  handler: async (_event, ctx) => {
    // ctx.systemDb is populated for r.systemScope() handlers only (feature.ts
    // declares it) — guarded instead of asserted, see set.write.ts Guard 0.5.
    if (!ctx.systemDb) {
      throw new Error(
        "[feature-toggles] registered-query requires ctx.systemDb — the feature-toggles " +
          "feature must stay r.systemScope() (see feature.ts).",
      );
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(FEATURE_TOGGLE_CROSS_TENANT_REASON);

    type OverrideRow = { featureName: string; enabled: boolean };
    const overrideRows = await db.global(globalFeatureStateTable).selectMany<OverrideRow>();
    const overrides = new Map(overrideRows.map((r) => [r.featureName, r.enabled]));

    // SystemAdmin operator tooling: the listing must show platform truth
    // (all features in the registry), not its own tier cut.
    // The per-tenant signature requires SYSTEM_TENANT_ID; the app resolver
    // returns the union of all tier features. The sentinel convention is
    // documented in DispatcherOptions.effectiveFeatures.
    const effective = ctx.services.effectiveFeatures?.(SYSTEM_TENANT_ID);

    const rows: Array<{
      id: string;
      name: string;
      toggleable: boolean;
      default: boolean | null;
      override: boolean | null;
      requires: readonly string[];
      effective: boolean | null;
      defaultLabel: string;
      overrideLabel: string;
      effectiveLabel: string;
      nextEnabled: boolean;
    }> = [];

    for (const feature of ctx.registry.features.values()) {
      const toggleable = feature.toggleableDefault !== undefined;
      const override = overrides.get(feature.name);
      const defaultValue = feature.toggleableDefault ?? null;
      const effectiveValue = effective ? effective.has(feature.name) : null;
      const effectiveBool = effectiveValue ?? defaultValue ?? false;

      rows.push({
        id: feature.name,
        name: feature.name,
        toggleable,
        // Raw booleans for API consumers; label fields for projectionList columns.
        default: defaultValue,
        override: override ?? null,
        requires: feature.requires,
        effective: effectiveValue,
        defaultLabel: formatFlag(defaultValue),
        overrideLabel: formatFlag(override ?? null),
        effectiveLabel: formatFlag(effectiveValue),
        nextEnabled: !effectiveBool,
      });
    }

    return { rows, nextCursor: null };
  },
});
