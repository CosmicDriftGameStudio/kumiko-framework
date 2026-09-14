import type { FeatureDefinition } from "../types";

// Boot-time twin of event-store-executor-context.ts's buildExecutorContext check —
// surfaces the systemStream invariant once across all features before any dispatch.
//
// A "global" entity also requires r.systemScope() — otherwise convention writes
// dispatch in tenant-mode and a global row could carry the creating tenant's id.
export function validateGlobalTenancyEntities(features: readonly FeatureDefinition[]): void {
  for (const feature of features) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      if (entity.tenancy !== "global") continue;
      if (entity.systemStream !== true) {
        throw new Error(
          `Feature "${feature.name}" entity "${entityName}": tenancy: "global" entities must ` +
            "also declare systemStream: true — a global aggregate's event stream must live on " +
            "the system tenant, not the creating tenant's.",
        );
      }
      if (!feature.systemScope) {
        throw new Error(
          `Feature "${feature.name}" entity "${entityName}": tenancy: "global" entities require ` +
            "their owning feature to declare r.systemScope() — without it, convention writes run " +
            "in tenant-mode and a global row could end up carrying the creating tenant's id " +
            "instead of the system tenant's.",
        );
      }
    }
  }
}
