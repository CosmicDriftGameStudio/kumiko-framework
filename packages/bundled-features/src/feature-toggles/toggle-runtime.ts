import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  computeEffectiveFeatures,
  type Registry,
  type ToggleReader,
} from "@cosmicdrift/kumiko-framework/engine";
import { globalFeatureStateTable } from "./global-feature-state-table";

// Cross-replica transport for a toggle flip (fw#2625). Deliberately narrow
// (featureName + enabled, not a generic channel/payload pair) so a caller
// can't wire the wrong signal instance in by accident — see
// createRedisToggleSyncSignal (toggle-sync-signal.ts) for the Redis-backed
// implementation, built on the framework's generic PubSubSignal.
export type ToggleSyncSignal = {
  publish(featureName: string, enabled: boolean): void;
  onMessage(listener: (featureName: string, enabled: boolean) => void): void;
};

// Holds the current global-override snapshot in memory and exposes a
// synchronous reader — the dispatcher's feature-gate calls it on every
// handler invocation, so this must not do I/O on the hot path. The
// snapshot is loaded once at boot via `.initialize()`, refreshed by the
// set-handler on the local instance, and kept in sync across instances by
// the `toggle-cache-sync` MSP (declared on the feature-toggles feature,
// delivery: "shared") calling `broadcastToggle()`. With a `syncSignal`
// configured (Redis — the same REDIS_URL-gated assumption the SSE broker
// makes), that fans out to every process; without one (single-process
// dev/test), `broadcastToggle` applies directly, matching the old
// per-instance behavior for the only process there is.
export class GlobalFeatureToggleRuntime {
  private snapshot = new Map<string, boolean>();

  constructor(
    private readonly db: DbConnection,
    private readonly registry: Registry,
    private readonly syncSignal?: ToggleSyncSignal,
  ) {
    // Every process, including the one that calls broadcastToggle, learns
    // of a flip through this same subscription — mirrors the SSE broker's
    // publish-then-echo-to-self pattern instead of a separate local-apply
    // path that could drift from the signal-delivered one.
    this.syncSignal?.onMessage((featureName, enabled) => {
      this.apply(featureName, enabled);
    });
  }

  async initialize(): Promise<void> {
    type Row = { featureName: string; enabled: boolean };
    const rows = await selectMany<Row>(this.db, globalFeatureStateTable);
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

  // Called by the toggle-cache-sync MSP handler (feature.ts) — the one
  // process whose shared cursor won a given toggle-set event. With a
  // syncSignal configured, publishing (rather than applying directly) is
  // what reaches every OTHER already-running process; this process learns
  // of its own publish the same way, through the constructor's
  // subscription. Without a syncSignal there is nobody else to reach, so
  // apply directly — this is the "no REDIS_URL" / single-process path.
  broadcastToggle(featureName: string, enabled: boolean): void {
    if (this.syncSignal) {
      this.syncSignal.publish(featureName, enabled);
      // skip: apply() runs when the publish echoes back through this
      // process's own subscription, not here — see the comment above.
      return;
    }
    this.apply(featureName, enabled);
  }

  // Raw per-feature override, bypassing the requires() cascade —
  // `undefined` means "no explicit row, inherits toggleableDefault"
  // (distinct from an explicit `false`). Used by composeTierResolver to
  // layer a global kill-switch UNDER a tenantTierResolver: the composed
  // resolver must only ever narrow what the tier already grants, never
  // fall back to a toggleable feature's declared default the way
  // effectiveFeatures()/computeEffectiveFeatures do — that default exists
  // for apps with no tier resolver, and would otherwise turn tier-gated
  // toggleable features (e.g. a Team-tier feature defaulting off) globally
  // off the moment feature-toggles is composed in.
  readOverride(featureName: string): boolean | undefined {
    return this.snapshot.get(featureName);
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
  syncSignal?: ToggleSyncSignal,
): Promise<GlobalFeatureToggleRuntime> {
  const runtime = new GlobalFeatureToggleRuntime(db, registry, syncSignal);
  await runtime.initialize();
  return runtime;
}
