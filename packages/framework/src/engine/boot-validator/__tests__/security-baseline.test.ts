import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { defineFeature } from "../../define-feature";
import type { FeatureDefinition } from "../../types";
import { validateBoot } from "../index";
import {
  SECURITY_BASELINE_FEATURE_NAMES,
  warnOnMissingSecurityBaseline,
} from "../security-baseline";

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

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0]);
    for (const name of SECURITY_BASELINE_FEATURE_NAMES) {
      expect(msg).toContain(name);
    }
  });

  test("production + only sessions/audit mounted → warns about the missing two only", () => {
    const features = [stubFeature("sessions"), stubFeature("audit")];

    warnOnMissingSecurityBaseline(features, "production");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0]);
    expect(msg).toContain("crypto-shredding");
    expect(msg).toContain("rate-limiting");
    expect(msg).not.toContain("missing feature(s): sessions");
  });

  test("production + all four baseline features mounted → no warning", () => {
    const features = SECURITY_BASELINE_FEATURE_NAMES.map((name) => stubFeature(name));

    warnOnMissingSecurityBaseline(features, "production");

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test.each(["development", "test", undefined])(
    "nodeEnv=%p + no baseline features → no warning",
    (nodeEnv) => {
      warnOnMissingSecurityBaseline([], nodeEnv);

      expect(warnSpy).not.toHaveBeenCalled();
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
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("production boot with no baseline features mounted warns but does not throw", () => {
    process.env["NODE_ENV"] = "production";

    expect(() => validateBoot([])).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
