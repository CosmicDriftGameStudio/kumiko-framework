import { describe, expect, test } from "bun:test";
import { isValidPreviewLoginLink, previewLoginSignature } from "../auth-routes-preview-login.ts";

// Shared with kumiko-studio's preview-login signer: same key, exp and expected signature.
const LOGIN_KEY = "test-login-key";
const EXP = "1700000060";
const EXPECTED_SIG = "fc83bf82342047b1f78d041ebada71e9a016a402fc97c41ccb5686b3f4a17fa7";
const NOW = 1700000000;

function check(overrides: Partial<Parameters<typeof isValidPreviewLoginLink>[0]> = {}) {
  return isValidPreviewLoginLink({
    loginKey: LOGIN_KEY,
    exp: EXP,
    sig: EXPECTED_SIG,
    nowSeconds: NOW,
    ...overrides,
  });
}

describe("preview login link", () => {
  test("signature matches the fixed test vector", () => {
    expect(previewLoginSignature(LOGIN_KEY, EXP)).toBe(EXPECTED_SIG);
  });

  test("a valid link passes", () => {
    expect(check()).toBe(true);
  });

  test("a wrong signature fails", () => {
    expect(check({ sig: previewLoginSignature("other-key", EXP) })).toBe(false);
  });

  test("a signature for another exp fails", () => {
    expect(check({ exp: "1700000061" })).toBe(false);
  });

  test("an expired link fails", () => {
    expect(check({ nowSeconds: Number(EXP) })).toBe(false);
    expect(check({ nowSeconds: Number(EXP) + 1 })).toBe(false);
  });

  test("an exp too far ahead fails even when correctly signed", () => {
    const farExp = String(NOW + 3600);
    expect(check({ exp: farExp, sig: previewLoginSignature(LOGIN_KEY, farExp) })).toBe(false);
  });

  test("malformed exp or sig fail", () => {
    expect(check({ exp: "17e8" })).toBe(false);
    expect(check({ exp: "-1" })).toBe(false);
    expect(check({ sig: EXPECTED_SIG.slice(2) })).toBe(false);
    expect(check({ sig: `${EXPECTED_SIG.slice(0, 62)}zz` })).toBe(false);
    expect(check({ exp: undefined })).toBe(false);
    expect(check({ sig: undefined })).toBe(false);
  });

  test("an empty login key never validates", () => {
    expect(check({ loginKey: "", sig: previewLoginSignature("", EXP) })).toBe(false);
  });
});
