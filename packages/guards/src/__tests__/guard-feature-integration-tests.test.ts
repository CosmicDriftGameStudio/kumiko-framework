import { describe, expect, test } from "bun:test";
import { computeOrphans, extractFeatureId } from "../guard-feature-integration-tests";

describe("extractFeatureId", () => {
  test("resolves a relative '../feature' import to the enclosing directory name", () => {
    expect(
      extractFeatureId(
        "../feature",
        "/repo/packages/bundled-features/src/audit/__tests__/audit.integration.test.ts",
      ),
    ).toBe("audit");
  });

  test("resolves a same-level './feature' import", () => {
    expect(
      extractFeatureId(
        "./feature",
        "/repo/packages/bundled-features/src/audit/some.integration.test.ts",
      ),
    ).toBe("audit");
  });

  test("resolves the bundled-features package subpath", () => {
    expect(
      extractFeatureId(
        "@cosmicdrift/kumiko-bundled-features/auth-foundation",
        "/repo/packages/dev-server/src/__tests__/walkthrough.integration.test.ts",
      ),
    ).toBe("auth-foundation");
  });

  test("resolves a sibling module import inside the feature directory (not just feature.ts)", () => {
    expect(
      extractFeatureId(
        "../tenant-defaults",
        "/repo/packages/bundled-features/src/tenant-settings/__tests__/tenant-settings.integration.test.ts",
      ),
    ).toBe("tenant-settings");
  });

  test("resolves a relative barrel import into a different feature's directory", () => {
    expect(
      extractFeatureId(
        "../../config",
        "/repo/packages/bundled-features/src/tenant-lifecycle/__tests__/tenant-lifecycle.integration.test.ts",
      ),
    ).toBe("config");
  });

  test("ignores relative imports that resolve outside bundled-features/src", () => {
    expect(
      extractFeatureId(
        "../event-store",
        "/repo/packages/framework/src/pipeline/__tests__/pipeline.integration.test.ts",
      ),
    ).toBeNull();
  });

  test("ignores unrelated package imports", () => {
    expect(
      extractFeatureId(
        "@cosmicdrift/kumiko-framework/engine",
        "/repo/packages/bundled-features/src/audit/__tests__/audit.integration.test.ts",
      ),
    ).toBeNull();
  });

  test("does not match a bare 'feature' package name without the bundled-features prefix", () => {
    expect(extractFeatureId("feature", "/repo/x.ts")).toBeNull();
  });

  test("ignores a relative import that never leaves __tests__ (helpers/fixtures don't prove the feature itself is imported)", () => {
    expect(
      extractFeatureId(
        "./helpers",
        "/repo/packages/bundled-features/src/audit/__tests__/audit.integration.test.ts",
      ),
    ).toBeNull();
  });
});

describe("computeOrphans", () => {
  test("flags a feature that no integration test imports", () => {
    const features = new Map([
      ["audit", "packages/bundled-features/src/audit/feature.ts"],
      ["sessions", "packages/bundled-features/src/sessions/feature.ts"],
    ]);
    const imported = new Set(["audit"]);

    const orphans = computeOrphans(features, imported, new Set());

    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.name).toBe("sessions");
  });

  test("reports no orphans once every feature is imported somewhere", () => {
    const features = new Map([["audit", "packages/bundled-features/src/audit/feature.ts"]]);
    const imported = new Set(["audit"]);

    expect(computeOrphans(features, imported, new Set())).toHaveLength(0);
  });

  test("does not flag an allowlisted feature even without an integration test (module-global ALLOWLIST is mutable, so a passed-in allowlist must not be shadowed)", () => {
    const features = new Map([
      ["step-dispatcher", "packages/bundled-features/src/step-dispatcher/feature.ts"],
    ]);
    const imported = new Set<string>();

    expect(computeOrphans(features, imported, new Set(["step-dispatcher"]))).toHaveLength(0);
  });
});
