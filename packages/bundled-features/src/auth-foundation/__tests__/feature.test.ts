// feature.ts contract tests — pin the public surface of the Plugin-API-
// shaped auth-foundation. Provider-specific verification logic is tested in
// each provider-feature's own __tests__.

import { describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "../feature.ts";
import {
  EXT_SESSION_STORE,
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  EXT_TOKEN_VERIFIER,
} from "../types.ts";

describe("authFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(createAuthFoundationFeature().name).toBe("auth-foundation");
  });

  test("has no hard requirements — no config-key, unlike file/mail-foundation", () => {
    expect(createAuthFoundationFeature().requires).toEqual([]);
  });
});

describe("authFoundationFeature — registers extension-point", () => {
  test("declares the tokenVerifier extension-point", () => {
    expect(Object.keys(createAuthFoundationFeature().registrarExtensions)).toContain(
      EXT_TOKEN_VERIFIER,
    );
  });

  test("declares the sessionStore extension-point", () => {
    expect(Object.keys(createAuthFoundationFeature().registrarExtensions)).toContain(
      EXT_SESSION_STORE,
    );
  });

  test("declares the tenantResolver extension-point", () => {
    expect(Object.keys(createAuthFoundationFeature().registrarExtensions)).toContain(
      EXT_TENANT_RESOLVER,
    );
  });

  test("declares the tenantExistence extension-point", () => {
    expect(Object.keys(createAuthFoundationFeature().registrarExtensions)).toContain(
      EXT_TENANT_EXISTENCE,
    );
  });
});

describe("authFoundationFeature — multiplicity boot-check", () => {
  test("registers a bootCheck per extension-point (token/session/tenant×2)", () => {
    expect(createAuthFoundationFeature().bootChecks.length).toBeGreaterThanOrEqual(4);
  });
});
