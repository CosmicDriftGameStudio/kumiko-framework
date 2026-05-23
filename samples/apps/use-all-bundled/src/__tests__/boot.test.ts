// Boot smoke-test for use-all-bundled. Runs every bundled-feature
// through composeFeatures + validateBoot + createRegistry without
// DB/Redis (KUMIKO_DRY_RUN_ENV=boot path). This is the CI-gate that
// catches Sprint-9.8-style framework-bugs (Object.entries(undefined),
// self-extension, missing-requires, …) before they reach a real app.

import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { describe, expect, test } from "vitest";
import { APP_FEATURES } from "../run-config";

const composedFeatures = composeFeatures([...APP_FEATURES], {
  includeBundled: true,
});

describe("use-all-bundled boot composition", () => {
  test("composeFeatures prepends bundled (config/user/tenant/auth-email-pw)", () => {
    const featureNames = composedFeatures.map((f) => f.name);
    expect(featureNames).toContain("config");
    expect(featureNames).toContain("user");
    expect(featureNames).toContain("tenant");
    expect(featureNames).toContain("auth-email-password");
    // bundled before app: config comes first
    const configIdx = featureNames.indexOf("config");
    const auditIdx = featureNames.indexOf("audit");
    expect(configIdx).toBeLessThan(auditIdx);
  });

  test("validateBoot — every r.requires resolves", () => {
    expect(() => validateBoot(composedFeatures)).not.toThrow();
  });

  test("createRegistry succeeds + every mounted feature is queryable", () => {
    const registry = createRegistry(composedFeatures);
    for (const f of composedFeatures) {
      expect(registry.getFeature(f.name)).toBeDefined();
    }
  });

  test("expected feature-count: 30 (26 explicit in APP_FEATURES + 4 auto-mounted)", () => {
    expect(composedFeatures.length).toBe(30);
  });
});
