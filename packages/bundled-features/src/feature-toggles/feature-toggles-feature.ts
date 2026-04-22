import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
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
  readonly getRuntime: () => GlobalFeatureToggleRuntime;
};

export function createFeatureTogglesFeature(options: FeatureTogglesOptions): FeatureDefinition {
  return defineFeature("feature-toggles", (r) => {
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

    return { handlers, queries };
  });
}

export { FEATURE_TOGGLE_SET_EVENT_NAME, FeatureToggleErrors } from "./constants";
export { globalFeatureStateTable } from "./global-feature-state-table";
// Re-export the runtime factory + class so app-boot code has a single
// import path: "@kumiko/bundled-features/feature-toggles".
export {
  createFeatureToggleRuntime,
  GlobalFeatureToggleRuntime,
} from "./toggle-runtime";
