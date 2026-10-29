import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { BootValidationError, type BootViolation } from "../boot-rule.ts";
import { validateNavBootSubset } from "../index.ts";

function violationsOf(fn: () => void): readonly BootViolation[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations;
    throw e;
  }
  throw new Error("expected BootValidationError");
}

function messageOf(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e.message;
  }
  throw new Error("expected function to throw");
}

const danglingNav = (featureName: string) =>
  defineFeature(featureName, (r) => {
    r.nav({ id: "home", label: "Home", screen: `${featureName}:screen:missing` });
  });

const failingBootCheck = (featureName: string, text: string) =>
  defineFeature(featureName, (r) => {
    r.bootCheck(() => {
      throw new Error(text);
    });
  });

const fileFeature = defineFeature("docs", (r) => {
  r.entity({
    name: "doc",
    ...createEntity({ table: "Docs", fields: { contract: { type: "file" } } }),
  });
});

const ENV_WITHOUT_FILE_PROVIDER = {};

describe("validateBoot collects violations", () => {
  test("violations of phases 2, 3 and 4 arrive as one error", () => {
    const features = [
      danglingNav("alpha"),
      danglingNav("beta"),
      failingBootCheck("gamma", "gamma invariant broken"),
      fileFeature,
    ];
    const run = () => validateBoot(features, { env: ENV_WITHOUT_FILE_PROVIDER });
    const violations = violationsOf(run);
    expect(violations.map((v) => [v.check, v.feature])).toEqual([
      ["validateNavs", "alpha"],
      ["validateNavs", "beta"],
      ["runFeatureBootCheck", "gamma"],
      ["fileStorageProvider", undefined],
    ]);
    expect(violations.map((v) => v.ruleId)).toEqual([
      "unclassified/validateNavs",
      "unclassified/validateNavs",
      "boot-check/failed",
      "unclassified/fileStorageProvider",
    ]);
    const message = messageOf(run);
    expect(message).toContain("Boot validation failed: 4 violations");
    for (const v of violations) expect(message).toContain(v.message);
    expect(message).toContain("alpha:screen:missing");
    expect(message).toContain("[Feature gamma] r.bootCheck failed: gamma invariant broken");
    expect(message).toContain("FILE_STORAGE_PROVIDER");
  });

  test("a single violation still carries the header", () => {
    const message = messageOf(() => validateBoot([danglingNav("alpha")]));
    expect(message).toStartWith(
      "Boot validation failed: 1 violation\n- [unclassified/validateNavs]",
    );
  });

  test("two failing bootChecks in two features are both reported with their prefix", () => {
    const violations = violationsOf(() =>
      validateBoot([
        failingBootCheck("one", "first broke"),
        failingBootCheck("two", "second broke"),
      ]),
    );
    expect(violations.map((v) => v.message)).toEqual([
      "[Feature one] r.bootCheck failed: first broke",
      "[Feature two] r.bootCheck failed: second broke",
    ]);
    expect(violations.map((v) => v.feature)).toEqual(["one", "two"]);
  });

  test("a structural violation aborts before later phases", () => {
    const exposesA = defineFeature("one", (r) => {
      r.exposesApi("shared.api");
    });
    const exposesB = defineFeature("two", (r) => {
      r.exposesApi("shared.api");
    });
    const violations = violationsOf(() => validateBoot([exposesA, exposesB, danglingNav("alpha")]));
    expect(violations.map((v) => v.check)).toEqual(["collectExposedApis"]);
    expect(violations[0]?.message).toContain('Cross-feature API "shared.api"');
  });

  test("a wiring violation suppresses validateScreens for the same feature only", () => {
    const wired = defineFeature("shop", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["nonexistent"],
        rowActions: [
          {
            kind: "writeHandler",
            id: "sync",
            label: "actions.sync",
            handler: "shop:write:sync",
            payload: Object.assign(() => ({}), { pick: ["name"] }),
          },
        ],
      });
      r.writeHandler({
        name: "sync",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true as const, data: null }),
        access: { roles: ["Admin"] },
      });
    });
    const violations = violationsOf(() => validateBoot([wired]));
    const checks = violations.filter((v) => v.feature === "shop").map((v) => v.check);
    expect(checks).toContain("validateActionWiring");
    expect(checks).not.toContain("validateScreens");
  });
});

describe("validateNavBootSubset collects violations", () => {
  test("nav errors in two features are both reported", () => {
    const violations = violationsOf(() =>
      validateNavBootSubset([danglingNav("alpha"), danglingNav("beta")]),
    );
    expect(violations.map((v) => [v.check, v.feature])).toEqual([
      ["validateNavs", "alpha"],
      ["validateNavs", "beta"],
    ]);
  });
});
