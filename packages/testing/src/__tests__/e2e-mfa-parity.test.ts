import { describe, expect, test } from "bun:test";
import {
  AuthMfaHandlers,
  base32Decode as bundledBase32Decode,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { currentTotpCode as bundledTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import { AUTH_MFA_ENABLE_CONFIRM_QN, AUTH_MFA_ENABLE_START_QN } from "../e2e/constants";
import { base32Decode, currentTotpCode } from "../e2e/totp";

describe("e2e kit copies of auth-mfa", () => {
  test("the enrollment handler names match auth-mfa", () => {
    expect(AUTH_MFA_ENABLE_START_QN).toBe(AuthMfaHandlers.enableStart);
    expect(AUTH_MFA_ENABLE_CONFIRM_QN).toBe(AuthMfaHandlers.enableConfirm);
  });

  test("base32 decoding and TOTP codes equal the bundled implementation", () => {
    const secret = Buffer.from("12345678901234567890");
    const encoded = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(base32Decode(encoded).equals(bundledBase32Decode(encoded))).toBe(true);
    for (const nowMs of [59_000, 1_111_111_109_000, 2_000_000_000_000]) {
      expect(currentTotpCode(secret, nowMs)).toBe(bundledTotpCode(secret, nowMs));
    }
  });
});
