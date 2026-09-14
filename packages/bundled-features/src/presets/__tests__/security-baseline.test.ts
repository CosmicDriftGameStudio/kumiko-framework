import { describe, expect, test } from "bun:test";
import { SECURITY_BASELINE_FEATURE_NAMES } from "@cosmicdrift/kumiko-framework/engine";
import { dsgvoSelfServiceFeatures } from "../dsgvo-self-service";
import { securityBaselineFeatures } from "../security-baseline";

describe("securityBaselineFeatures", () => {
  test("returns exactly the SECURITY_BASELINE_FEATURE_NAMES feature names", () => {
    const names = securityBaselineFeatures().map((f) => f.name);
    expect(names).toEqual([...SECURITY_BASELINE_FEATURE_NAMES]);
  });

  test("includeSessions:false omits sessions but keeps the other three", () => {
    const names = securityBaselineFeatures({ includeSessions: false }).map((f) => f.name);
    expect(names).not.toContain("sessions");
    expect(names).toEqual(["crypto-shredding", "rate-limiting", "audit"]);
  });

  test("combined with dsgvoSelfServiceFeatures({ includeSessions: false }) has no duplicate names and covers the baseline", () => {
    const combined = [
      ...dsgvoSelfServiceFeatures(),
      ...securityBaselineFeatures({ includeSessions: false }),
    ];
    const names = combined.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of SECURITY_BASELINE_FEATURE_NAMES) {
      expect(names).toContain(name);
    }
  });

  test("each call yields fresh feature instances (no shared mutable state)", () => {
    const a = securityBaselineFeatures();
    const b = securityBaselineFeatures();
    expect(a[0]).not.toBe(b[0]);
  });
});
