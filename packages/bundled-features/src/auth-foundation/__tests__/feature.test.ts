// feature.ts contract tests — pin the public surface of the Plugin-API-
// shaped auth-foundation. Provider-specific verification logic is tested in
// each provider-feature's own __tests__.

import { describe, expect, test } from "bun:test";
import { authFoundationFeature } from "../feature";
import { EXT_TOKEN_VERIFIER } from "../types";

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
});

describe("authFoundationFeature — multiplicity boot-check", () => {
  test("registers its own bootCheck", () => {
    expect(authFoundationFeature.bootChecks.length).toBeGreaterThan(0);
  });
});
