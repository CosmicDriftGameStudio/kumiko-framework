import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { FEATURE_TOGGLE_SET_EVENT_NAME } from "./constants";
import { featureToggleSetSchema } from "./events";
import { listQuery } from "./handlers/list.query";
import { registeredQuery } from "./handlers/registered.query";
import { createSetWriteHandler } from "./handlers/set.write";
import type { GlobalFeatureToggleRuntime } from "./toggle-runtime";

// IMPORTANT: feature-toggles itself is NOT r.toggleable. Making it
// toggleable would brick the system — once disabled, no handler of this
// feature is reachable to turn it back on. The boot-validator won't catch
// this (it only warns about dependency shapes), so the guarantee lives in
// this file: do not add r.toggleable() here.

export type FeatureTogglesOptions = {
  // Accessor for the in-memory snapshot the dispatcher gate reads. Must
  // return a resolved runtime by the time the feature's set-handler is
  // called — NOT by the time the feature is registered. This matters
  // because createFeatureToggleRuntime needs the registry that
  // setupTestStack / buildServer builds from the feature list, so the
  // runtime and the feature are chicken-and-egg at wire-up time. Passing
  // an accessor (vs the runtime directly) lets the caller close over a
  // mutable holder.
  //
  // Production setup: resolve the runtime after buildServer returns, then
  // pass `() => runtime`. For tests, use createLateBoundHolder + .get().
  //
  // **Optional** — boot-mode (KUMIKO_DRY_RUN_ENV=boot) wires the feature
  // up without ever calling the set-handler, so a runtime-stub is then
  // pure cargo-cult. Omit `getRuntime` and the handler throws lazily on
  // first call with an actionable message. App-authors who DO route to
  // the set-handler at runtime MUST supply the accessor.
  readonly getRuntime?: () => GlobalFeatureToggleRuntime;
};

export function createFeatureTogglesFeature(
  options: FeatureTogglesOptions = {},
): FeatureDefinition {
  return defineFeature("feature-toggles", (r) => {
    r.describe(
      'Persists per-feature enabled/disabled state in the `read_global_feature_state` table and exposes a `set` write-handler plus `list`/`registered` query-handlers so operators can flip features at runtime without redeploying. Each API instance keeps an in-memory `GlobalFeatureToggleRuntime` snapshot (initialize it via `createFeatureToggleRuntime`, pass a `() => runtime` accessor to `createFeatureTogglesFeature`) that the dispatcher gate reads on every request; a `toggle-cache-sync` multi-stream projection with `delivery: "per-instance"` syncs the snapshot across instances whenever a `toggle-set` event is appended.',
    );
    r.systemScope();

    // Toggle-change domain event. The event ends up in the events-table
    // alongside every other write — audit.list picks it up automatically,
    // no dedicated projection needed. Qualified name after prefixing:
    // "feature-toggles:event:toggle-set" (see constants.FEATURE_TOGGLE_SET_EVENT_NAME).
    r.defineEvent("toggle-set", featureToggleSetSchema);

    const handlers = {
      set: r.writeHandler(createSetWriteHandler(options.getRuntime)),
    };

    const queries = {
      list: r.queryHandler(listQuery),
      registered: r.queryHandler(registeredQuery),
    };

    // toggle-cache-sync — multi-instance snapshot propagation. Every
    // API/worker instance runs its own dispatcher cursor on this MSP
    // (delivery: "per-instance") and converges its in-memory snapshot on
    // every toggle-set event it observes. Named "cache-sync" (not
    // "projection" or "audit") because it's side-effect-only
    // infrastructure — the framework's boot-validator also rejects
    // per-instance MSPs that carry a `table`.
    //
    // Why this is correct alongside the set-handler's own `runtime.apply`:
    //   - local apply = immediate response-latency optimization so the
    //     next request on the same instance sees the flip without a
    //     dispatcher-tick round-trip
    //   - MSP = multi-instance propagation + crash-recovery. If a process
    //     crashes between appendEvent (persisted) and the local apply
    //     (volatile), the MSP rebuilds the snapshot on restart; if
    //     instance B never ran the write, the MSP is how it learns. Both
    //     paths are idempotent — apply is Map.set, replay on boot just
    //     converges to the DB state that initialize() already loaded.
    //
    // Requires: options.getRuntime() must resolve by the time the
    // dispatcher processes its first toggle-set event. The holder-based
    // wire-up (see FeatureTogglesOptions.getRuntime docstring) guarantees
    // this in setupTestStack and production boot.
    r.multiStreamProjection({
      name: "toggle-cache-sync",
      delivery: "per-instance",
      apply: {
        [FEATURE_TOGGLE_SET_EVENT_NAME]: async (event) => {
          // The event payload shape is guaranteed by featureToggleSetSchema
          // (validated on append). Shallow-cast to a typed shape rather
          // than re-parsing — the payload round-trips through JSON and is
          // fixed at the source.
          const payload = event.payload as { featureName: string; enabled: boolean }; // @cast-boundary engine-payload
          if (!options.getRuntime) {
            throw new Error(
              "[feature-toggles] toggle-cache-sync MSP fired but createFeatureTogglesFeature " +
                "was wired up without `getRuntime`. Wire the accessor in your app-config.",
            );
          }
          options.getRuntime().apply(payload.featureName, payload.enabled);
        },
      },
    });

    return { handlers, queries };
  });
}

export { FEATURE_TOGGLE_SET_EVENT_NAME, FeatureToggleErrors } from "./constants";
export { globalFeatureStateTable } from "./global-feature-state-table";
// Re-export the runtime factory + class so app-boot code has a single
// import path: "@cosmicdrift/kumiko-bundled-features/feature-toggles".
export {
  createFeatureToggleRuntime,
  GlobalFeatureToggleRuntime,
} from "./toggle-runtime";
