import { describe, expect, test } from "bun:test";
import {
  invalidChallengeToken,
  invalidRecoveryCode,
  invalidSetupToken,
  invalidTotpCode,
  mfaAlreadyEnabled,
  mfaNotEnabled,
  tooManyAttempts,
} from "../errors";
import { defaultTranslations } from "../web/i18n";

const failures = {
  mfaAlreadyEnabled: mfaAlreadyEnabled(),
  mfaNotEnabled: mfaNotEnabled(),
  invalidSetupToken: invalidSetupToken(),
  invalidTotpCode: invalidTotpCode(),
  invalidRecoveryCode: invalidRecoveryCode(),
  invalidChallengeToken: invalidChallengeToken(),
  tooManyAttempts: tooManyAttempts(30),
};

describe("auth-mfa errors.ts i18nKey / client-bundle parity", () => {
  for (const [name, failure] of Object.entries(failures)) {
    test(`${name}'s i18nKey is registered in en/de translations`, () => {
      const key = failure.error.i18nKey;
      expect(defaultTranslations["en"]?.[key]).toBeDefined();
      expect(defaultTranslations["de"]?.[key]).toBeDefined();
    });
  }
});
