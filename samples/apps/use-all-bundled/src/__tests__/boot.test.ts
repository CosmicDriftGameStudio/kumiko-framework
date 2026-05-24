// Boot smoke-test for use-all-bundled. Runs every bundled-feature
// through composeFeatures + validateBoot + createRegistry without
// DB/Redis (KUMIKO_DRY_RUN_ENV=boot path). This is the CI-gate that
// catches Sprint-9.8-style framework-bugs (Object.entries(undefined),
// self-extension, missing-requires, …) before they reach a real app.
//
// Scope: this file tests THIS SAMPLE's boot wiring. Framework-level
// composeFeatures behaviour (auth-mode bundled-prepend, ordering) is
// covered by framework's own tests — mixing scopes here would let
// a framework-refactor fail the sample's CI for the wrong reason.
// Coverage of "every bundled-export is mounted" lives in M5's
// scripts/check-coverage.ts, not in a brittle hardcoded count-assert.

import { describe, expect, test } from "bun:test";
import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { createRegistry, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { APP_FEATURES } from "../run-config";

const composedFeatures = composeFeatures([...APP_FEATURES], {
  includeBundled: true,
});

describe("use-all-bundled boot", () => {
  test("validateBoot — every r.requires resolves", () => {
    expect(() => validateBoot(composedFeatures)).not.toThrow();
  });

  test("createRegistry succeeds + every mounted feature is queryable", () => {
    const registry = createRegistry(composedFeatures);
    for (const f of composedFeatures) {
      expect(registry.getFeature(f.name)).toBeDefined();
    }
  });
});
