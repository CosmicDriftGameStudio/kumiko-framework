import type { FeatureDefinition } from "../types";

// Boot-time twin of event-store-executor-context.ts's buildExecutorContext check —
// surfaces the systemStream invariant once across all features before any dispatch.
export function validateGlobalTenancyEntities(features: readonly FeatureDefinition[]): void {
  for (const feature of features) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      if (entity.tenancy === "global" && entity.systemStream !== true) {
        throw new Error(
          `Feature "${feature.name}" entity "${entityName}": tenancy: "global" entities must ` +
            "also declare systemStream: true — a global aggregate's event stream must live on " +
            "the system tenant, not the creating tenant's.",
        );
      }
    }
  }
}
