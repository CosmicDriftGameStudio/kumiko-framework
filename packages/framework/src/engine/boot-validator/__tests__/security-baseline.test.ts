import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { consoleCallsMentioning } from "@cosmicdrift/kumiko-testing/helpers";
import { defineFeature } from "../../define-feature.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { validateBoot } from "../index.ts";
import {
  SECURITY_BASELINE_FEATURE_NAMES,
  warnOnMissingSecurityBaseline,
} from "../security-baseline.ts";

function stubFeature(name: string): FeatureDefinition {
  return defineFeature(name, () => {});
}

describe("warnOnMissingSecurityBaseline", () => {
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("production + no baseline features → warns once, naming all four", () => {
    warnOnMissingSecurityBaseline([], "production");

    const warnings = consoleCallsMentioning(warnSpy, "security baseline is incomplete");
    expect(warnings).toHaveLength(1);
    const msg = String(warnings[0]?.[0]);
    for (const name of SECURITY_BASELINE_FEATURE_NAMES) {
      expect(msg).toContain(name);
    }
  });

  test("production + only sessions/audit mounted → warns about the missing two only", () => {
    const features = [stubFeature("sessions"), stubFeature("audit")];

    warnOnMissingSecurityBaseline(features, "production");

    const warnings = consoleCallsMentioning(warnSpy, "security baseline is incomplete");
    expect(warnings).toHaveLength(1);
    const msg = String(warnings[0]?.[0]);
    expect(msg).toContain("missing feature(s): crypto-shredding, rate-limiting.");
  });

  test("production + all four baseline features mounted → no warning", () => {
    const features = SECURITY_BASELINE_FEATURE_NAMES.map((name) => stubFeature(name));

    warnOnMissingSecurityBaseline(features, "production");

    expect(consoleCallsMentioning(warnSpy, "security baseline is incomplete")).toHaveLength(0);
  });

  test.each(["development", "test", undefined])(
    "nodeEnv=%p + no baseline features → no warning",
    (nodeEnv) => {
      warnOnMissingSecurityBaseline([], nodeEnv);

      expect(consoleCallsMentioning(warnSpy, "security baseline is incomplete")).toHaveLength(0);
    },
  );

  test("never throws, regardless of nodeEnv or mounted features", () => {
    expect(() => warnOnMissingSecurityBaseline([], "production")).not.toThrow();
    expect(() => warnOnMissingSecurityBaseline([], "development")).not.toThrow();
    expect(() =>
      warnOnMissingSecurityBaseline(
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
    expect(consoleCallsMentioning(warnSpy, "security baseline is incomplete")).toHaveLength(0);
  });

  test("production boot with no baseline features mounted warns but does not throw", () => {
    process.env["NODE_ENV"] = "production";

    expect(() => validateBoot([])).not.toThrow();
    expect(consoleCallsMentioning(warnSpy, "security baseline is incomplete")).toHaveLength(1);
  });
});
