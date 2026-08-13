// framework#2076: set.write / registered.query / list.query all read/write
// globalFeatureStateTable via ctx.systemDb.acknowledgeCrossTenant(...) instead
// of ctx.db directly. That only resolves correctly as long as the
// feature-toggles feature stays r.systemScope() (feature.ts) — buildHandlerContext
// only populates ctx.systemDb for system-scoped handlers (dispatch-shared.ts).
// This test pins that coupling so a future refactor that drops r.systemScope()
// fails loudly here instead of surfacing as "undefined.acknowledgeCrossTenant"
// deep inside a handler.

import { describe, expect, test } from "bun:test";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { FeatureToggleHandlers, FeatureToggleQueries } from "../constants";
import { createFeatureTogglesFeature } from "../feature";

describe("feature-toggles handlers stay r.systemScope()-coupled", () => {
  const registry = createRegistry([createFeatureTogglesFeature()]);

  test("set/list/registered are all system-scoped", () => {
    expect(registry.isHandlerSystemScoped(FeatureToggleHandlers.set)).toBe(true);
    expect(registry.isHandlerSystemScoped(FeatureToggleQueries.list)).toBe(true);
    expect(registry.isHandlerSystemScoped(FeatureToggleQueries.registered)).toBe(true);
  });
});
