// feature.ts contract tests — pin the public surface of the Plugin-API-
// shaped auth-foundation. Provider-specific verification logic is tested in
// each provider-feature's own __tests__.

import { describe, expect, test } from "bun:test";
import { authFoundationFeature } from "../feature";
import { EXT_SESSION_STORE, EXT_TOKEN_VERIFIER } from "../types";

describe("authFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(authFoundationFeature.name).toBe("auth-foundation");
  });

  test("has no hard requirements — no config-key, unlike file/mail-foundation", () => {
    expect(authFoundationFeature.requires).toEqual([]);
  });
});

describe("authFoundationFeature — registers extension-point", () => {
  test("declares the tokenVerifier extension-point", () => {
    expect(authFoundationFeature.registrarExtensions[EXT_TOKEN_VERIFIER]).toBeDefined();
  });

  test("declares the sessionStore extension-point", () => {
    expect(authFoundationFeature.registrarExtensions[EXT_SESSION_STORE]).toBeDefined();
  });
});

describe("authFoundationFeature — multiplicity boot-check", () => {
  test("registers a bootCheck per extension-point (tokenVerifier + sessionStore)", () => {
    expect(authFoundationFeature.bootChecks.length).toBeGreaterThanOrEqual(2);
  });
});
