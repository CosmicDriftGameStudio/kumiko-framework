import { describe, expect, test } from "bun:test";
import { createAuthEmailPasswordFeature } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createCryptoShreddingFeature } from "@cosmicdrift/kumiko-bundled-features/crypto-shredding";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import {
  createRegistry,
  defineFeature,
  SECURITY_BASELINE_FEATURE_NAMES,
} from "@cosmicdrift/kumiko-framework/engine";
import { dsgvoSelfServiceFeatures } from "../dsgvo-self-service";
import { securityBaselineFeatures } from "../security-baseline";

// Minimal host every combo below needs: sessions requires user +
// auth-foundation, audit requires tenant, tenant requires config.
const HOST_FEATURES = [
  createConfigFeature(),
  createUserFeature(),
  createTenantFeature(),
  authFoundationFeature,
];

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

  test("dsgvoSelfServiceFeatures() + securityBaselineFeatures() boots with exactly one sessions", () => {
    // user-data-rights-defaults additionally requires "files" — a bare stub
    // is enough here, its own domain logic isn't exercised by this test.
    const filesStub = defineFeature("files", () => {});
    const registry = createRegistry([
      ...HOST_FEATURES,
      createAuthEmailPasswordFeature({}),
      filesStub,
      createUserDataRightsDefaultsFeature(),
      ...dsgvoSelfServiceFeatures(),
      ...securityBaselineFeatures(),
    ]);

    expect(registry.getFeature("sessions")).toBeDefined();
  });

  test("standalone sessions + crypto-shredding mounted alongside the preset boots (offlot case)", () => {
    const registry = createRegistry([
      ...HOST_FEATURES,
      createSessionsFeature(),
      createCryptoShreddingFeature(),
      ...securityBaselineFeatures(),
    ]);

    expect(registry.getFeature("sessions")).toBeDefined();
    expect(registry.getFeature("crypto-shredding")).toBeDefined();
  });

  test("sessions mounted with different options than the preset's throws a clear boot error", () => {
    expect(() =>
      createRegistry([
        ...HOST_FEATURES,
        createSessionsFeature({ expiresInMs: 1000 }),
        ...securityBaselineFeatures(),
      ]),
    ).toThrow(/Duplicate feature: "sessions".*different options/);
  });
});
