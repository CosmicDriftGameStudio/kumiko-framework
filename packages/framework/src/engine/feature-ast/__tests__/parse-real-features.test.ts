// Roundtrip tests against real Kumiko features. Stress-tests the
// extractor coverage with the same `defineFeature` calls that ship in
// bundled-features and the PublicStatus sample. Findings inform the
// Designer/AI authoring contract.
//
// **Key finding from C1.4:** real-world features authored before the
// AST visitor existed lean heavily on factory helpers (`createEntity`,
// `defineWriteHandler` returned via const) and identifier-typed handler
// arguments. Both are unreadable statically — readJsonLikeNode bails on
// function-call expressions, and extractHandlerLike requires a string
// literal name when used in inline form. Each surfaces a clean
// ParseError, never a crash.
//
// **Authoring contract** the Designer + AI Builder will demand:
//   - r.entity("name", { fields: { ... } })          ← inline literal
//   - r.writeHandler("name", schema, async (e, c) => …, options?)
//     OR r.writeHandler({ name: "name", schema, handler: async … })
//   - same for r.queryHandler / r.job / r.notification: NO captured
//     consts, NO factory wrappers around the definition
//
// bundled-features stay unchanged — they are framework-internal and
// optimised for code reuse, not for design-time editability. AI-
// generated features and Designer-authored features will follow the
// inline contract by construction.

import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { parseFeatureFile } from "../parse";
import type { FeaturePattern } from "../patterns";

const REPO_ROOT = resolve(__dirname, "../../../../../..");

type RealFeature = {
  readonly path: string;
  readonly expectedFeatureName: string;
  // Kinds the visitor recognises as proper patterns (the rest land as
  // ParseError because of factory/identifier usage — see the test
  // helper below).
  readonly recognisedKinds: readonly FeaturePattern["kind"][];
  // Method names that ParseError due to factory/identifier author style.
  // Empty for features that are entirely inline (rare today).
  readonly errorMethodNames: readonly string[];
};

const FEATURES: readonly RealFeature[] = [
  {
    path: "packages/bundled-features/src/tenant/feature.ts",
    expectedFeatureName: "tenant",
    recognisedKinds: ["requires", "systemScope"],
    errorMethodNames: ["entity", "config", "writeHandler", "queryHandler"],
  },
  {
    path: "packages/bundled-features/src/audit/feature.ts",
    expectedFeatureName: "audit",
    recognisedKinds: [],
    errorMethodNames: ["queryHandler"],
  },
  {
    path: "packages/bundled-features/src/sessions/feature.ts",
    expectedFeatureName: "sessions",
    recognisedKinds: ["entityHook"],
    errorMethodNames: ["entity", "writeHandler", "queryHandler", "job"],
  },
  {
    path: "packages/bundled-features/src/auth-email-password/feature.ts",
    expectedFeatureName: "auth-email-password",
    recognisedKinds: ["requires"],
    errorMethodNames: ["writeHandler"],
  },
  {
    path: "samples/showcases/publicstatus/src/features/publicstatus/feature.ts",
    expectedFeatureName: "publicstatus",
    recognisedKinds: ["defineEvent", "nav"],
    errorMethodNames: ["entity", "writeHandler", "queryHandler", "screen", "job", "translations"],
  },
];

describe("parseFeatureFile against real Kumiko features", () => {
  for (const feature of FEATURES) {
    test(`${feature.path}: featureName + recognised kinds + clean ParseErrors`, () => {
      const result = parseFeatureFile(resolve(REPO_ROOT, feature.path));

      // Always reads the feature name regardless of authoring style.
      expect(result.featureName).toBe(feature.expectedFeatureName);

      // Every kind we promised to extract for this feature shows up.
      const observedKinds = new Set(result.patterns.map((p) => p.kind));
      for (const expected of feature.recognisedKinds) {
        expect(observedKinds.has(expected), `expected kind "${expected}" in ${feature.path}`).toBe(
          true,
        );
      }

      // Every method we know fails statically (factory/identifier
      // authoring) shows up at least once in errors.
      const errorMethods = new Set(result.errors.map((e) => e.methodName));
      for (const expected of feature.errorMethodNames) {
        expect(
          errorMethods.has(expected),
          `expected ParseError methodName "${expected}" in ${feature.path}`,
        ).toBe(true);
      }
    });
  }

  test("aggregate: no UnknownPattern across real features (every r.* call is dispatched)", () => {
    // If this fails, a new r.* API has been added without an extractor +
    // dispatcher case. UnknownPattern is the catch-all signal — it's
    // legal but means the Designer/AI cannot edit that call.
    const allUnknowns: { feature: string; methodName: string }[] = [];
    for (const feature of FEATURES) {
      const result = parseFeatureFile(resolve(REPO_ROOT, feature.path));
      for (const pattern of result.patterns) {
        if (pattern.kind === "unknown") {
          allUnknowns.push({ feature: feature.path, methodName: pattern.methodName });
        }
      }
    }
    expect(allUnknowns).toEqual([]);
  });

  test("aggregate: every ParseError carries methodName + non-empty reason + source location", () => {
    for (const feature of FEATURES) {
      const result = parseFeatureFile(resolve(REPO_ROOT, feature.path));
      for (const error of result.errors) {
        expect(error.methodName).toMatch(/^[a-zA-Z]+$/);
        expect(error.reason.length).toBeGreaterThan(10);
        expect(error.source.file).toContain(feature.path.split("/").pop());
        expect(error.source.start.line).toBeGreaterThan(0);
        expect(error.source.raw).toContain("r.");
      }
    }
  });
});
