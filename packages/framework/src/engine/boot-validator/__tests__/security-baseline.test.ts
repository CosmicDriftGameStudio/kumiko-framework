import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  consoleCallsFromNamespace,
  consoleCallsMentioning,
} from "@cosmicdrift/kumiko-testing/helpers";
import { defineFeature } from "../../define-feature.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import type { BootWarning, BootWarningSink } from "../boot-warning.ts";
import { validateBoot } from "../index.ts";
import {
  SECURITY_BASELINE_FEATURE_NAMES,
  warnOnMissingSecurityBaseline,
} from "../security-baseline.ts";

function stubFeature(name: string): FeatureDefinition {
  return defineFeature(name, () => {});
}

describe("warnOnMissingSecurityBaseline", () => {
  let warnings: BootWarning[];
  const warn: BootWarningSink = (warning) => {
    warnings.push(warning);
  };

  beforeEach(() => {
    warnings = [];
  });

  test("production + no baseline features → warns once, naming all four", () => {
    warnOnMissingSecurityBaseline(warn, [], "production");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("security/baseline-incomplete");
    const msg = String(warnings[0]?.message);
    for (const name of SECURITY_BASELINE_FEATURE_NAMES) {
      expect(msg).toContain(name);
    }
    expect(msg).toContain("composeSecurityStack()");
    expect(msg).not.toContain("securityBaselineFeatures");
  });

  test("production + only sessions/audit mounted → warns about the missing two only", () => {
    const features = [stubFeature("sessions"), stubFeature("audit")];

    warnOnMissingSecurityBaseline(warn, features, "production");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("security/baseline-incomplete");
    const msg = String(warnings[0]?.message);
    expect(msg).toContain("missing feature(s): crypto-shredding, rate-limiting.");
  });

  test("production + all four baseline features mounted → no warning", () => {
    const features = SECURITY_BASELINE_FEATURE_NAMES.map((name) => stubFeature(name));

    warnOnMissingSecurityBaseline(warn, features, "production");

    expect(warnings).toHaveLength(0);
  });

  test.each(["development", "test", undefined])(
    "nodeEnv=%p + no baseline features → no warning",
    (nodeEnv) => {
      warnOnMissingSecurityBaseline(warn, [], nodeEnv);

      expect(warnings).toHaveLength(0);
    },
  );

  test("never throws, regardless of nodeEnv or mounted features", () => {
    expect(() => warnOnMissingSecurityBaseline(warn, [], "production")).not.toThrow();
    expect(() => warnOnMissingSecurityBaseline(warn, [], "development")).not.toThrow();
    expect(() =>
      warnOnMissingSecurityBaseline(
        warn,
        SECURITY_BASELINE_FEATURE_NAMES.map((name) => stubFeature(name)),
        "production",
      ),
    ).not.toThrow();
  });
});

describe("validateBoot + security baseline warning", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalNodeEnv === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = originalNodeEnv;
    }
  });

  test("production boot with all four baseline stubs mounted does not throw and does not warn", () => {
    process.env["NODE_ENV"] = "production";
    const features = SECURITY_BASELINE_FEATURE_NAMES.map((name) => stubFeature(name));

    expect(() => validateBoot(features)).not.toThrow();
    expect(consoleCallsFromNamespace(warnSpy, "kumiko:boot")).toHaveLength(0);
  });

  test("production boot with no baseline features mounted warns but does not throw", () => {
    process.env["NODE_ENV"] = "production";

    expect(() => validateBoot([])).not.toThrow();
    expect(consoleCallsMentioning(warnSpy, "security baseline is incomplete")).toHaveLength(1);
  });
});
