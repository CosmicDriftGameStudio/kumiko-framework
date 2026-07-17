import { describe, expect, test } from "bun:test";
import { AuthMfaErrorCodes } from "../../constants";
import { defaultTranslations } from "../i18n";
import { mfaManageErrorKey } from "../mfa-error-keys";

describe("mfaManageErrorKey", () => {
  for (const code of Object.values(AuthMfaErrorCodes)) {
    test(`${code} maps to a key registered in en/de translations`, () => {
      const key = mfaManageErrorKey(code);
      expect(defaultTranslations["en"]?.[key]).toBeDefined();
      expect(defaultTranslations["de"]?.[key]).toBeDefined();
    });
  }

  test("unknown code falls back to the generic verifyFailed key", () => {
    const key = mfaManageErrorKey("some_future_server_code");
    expect(key).toBe("auth.mfa.errors.verifyFailed");
    expect(defaultTranslations["en"]?.[key]).toBeDefined();
  });
});
