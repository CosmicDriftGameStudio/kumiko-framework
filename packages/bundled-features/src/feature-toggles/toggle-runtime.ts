import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  computeEffectiveFeatures,
  type Registry,
  type ToggleReader,
} from "@cosmicdrift/kumiko-framework/engine";
import { globalFeatureStateTable } from "./global-feature-state-table";

// Holds the current global-override snapshot in memory and exposes a
// synchronous reader — the dispatcher's feature-gate calls it on every
// handler invocation, so this must not do I/O on the hot path. The
// snapshot is loaded once at boot via `.initialize()`, refreshed by the
// set-handler on the local instance, and kept in sync across
// instances by the `toggle-cache-sync` MSP (declared on the
// feature-toggles feature, delivery: "per-instance"). Every API/worker
// process observes every toggle-set event and applies it to its local
// snapshot — no Redis / SSE / polling needed; the existing events-table
// + event-dispatcher pipeline handles propagation.
export class GlobalFeatureToggleRuntime {
  private snapshot = new Map<string, boolean>();

  constructor(
    private readonly db: DbConnection,
    private readonly registry: Registry,
  ) {}

  async initialize(): Promise<void> {
    const rows = await this.db
      .select({
        featureName: globalFeatureStateTable.featureName,
        enabled: globalFeatureStateTable.enabled,
      })
      .from(globalFeatureStateTable);
    this.snapshot = new Map(rows.map((r) => [r.featureName, r.enabled]));
  }

  // Re-read the full snapshot. Called from the set-handler after a
  // successful write — cheap point-update would be an optimisation but
  // the table is small (O(features)) and this keeps the cache honest in
  // the presence of concurrent external writes (seed scripts, ops SQL).
  async refresh(): Promise<void> {
    await this.initialize();
  }

  // In-memory cache update. Used by the set-handler when a single
  // featureName transitions — saves a round-trip compared to refresh()
  // while staying correct because set-handlers serialise via optimistic
  // lock. Kept alongside refresh() so both options are explicit.
  apply(featureName: string, enabled: boolean): void {
    this.snapshot.set(featureName, enabled);
  }

  // The callback shape the dispatcher expects. Computes the effective
  // feature set from the current snapshot + the registry's requires()
  // cascade every call. Cheap: the cascade is a DFS over O(features);
  // for the expected sizes (tens of features per app) this is ~µs.
  effectiveFeatures = (): ReadonlySet<string> => {
    const reader: ToggleReader = (name) => this.snapshot.get(name);
    return computeEffectiveFeatures(this.registry, reader);
  };
}

// Factory for app-boot wiring: instantiate, initialize, return both the
// runtime (for the set-handler to refresh) and the callback (for
// createDispatcher's effectiveFeatures option).
export async function createFeatureToggleRuntime(
  db: DbConnection,
  registry: Registry,
): Promise<GlobalFeatureToggleRuntime> {
  const runtime = new GlobalFeatureToggleRuntime(db, registry);
  await runtime.initialize();
  return runtime;
}
