// Security-Baseline Sample — Test
// Proves: APP_FEATURES boots clean, and the NODE_ENV=production boot warning
// fires only when the baseline features are missing, never for APP_FEATURES.

import { describe, expect, spyOn, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { APP_FEATURES } from "../feature";

function securityBaselineWarnings(calls: readonly unknown[][]): unknown[][] {
  return calls.filter(
    (call) => typeof call[0] === "string" && call[0].includes("security baseline"),
  );
}

describe("security-baseline sample", () => {
  test("APP_FEATURES boots without throwing", () => {
    expect(() => validateBoot(APP_FEATURES)).not.toThrow();
  });

  test("NODE_ENV=production + APP_FEATURES → no security-baseline warning", () => {
    const originalNodeEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      validateBoot(APP_FEATURES);
      expect(securityBaselineWarnings(warnSpy.mock.calls)).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      if (originalNodeEnv === undefined) {
        delete process.env["NODE_ENV"];
      } else {
        process.env["NODE_ENV"] = originalNodeEnv;
      }
    }
  });

  test("NODE_ENV=production + baseline features missing → warns but does not throw", () => {
    const originalNodeEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    // Keep "sessions" mounted — auth-foundation's own bootCheck requires a
    // tokenVerifier or sessionStore, and dropping it would fail boot for an
    // unrelated reason before warnOnMissingSecurityBaseline ever runs.
    const withoutBaseline = APP_FEATURES.filter(
      (f) => !["crypto-shredding", "rate-limiting", "audit"].includes(f.name),
    );

    try {
      expect(() => validateBoot(withoutBaseline)).not.toThrow();
      expect(securityBaselineWarnings(warnSpy.mock.calls)).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
      if (originalNodeEnv === undefined) {
        delete process.env["NODE_ENV"];
      } else {
        process.env["NODE_ENV"] = originalNodeEnv;
      }
    }
  });
});
