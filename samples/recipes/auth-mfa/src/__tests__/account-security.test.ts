import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  ACCOUNT_SECURITY_SCREEN_QN,
  createAccountSecurityFeature,
  createAuthMfaFeature,
} from "../feature";

const mfaFeature = createAuthMfaFeature({
  setupTokenSecret: "sample-setup-token-secret-not-for-prod",
  challengeTokenSecret: "sample-mfa-challenge-secret-at-least-32-bytes",
  issuer: "Kumiko Sample",
});

describe("account-security next to auth-mfa", () => {
  // user-mfa has encrypted fields, so boot validation needs a cipher.
  beforeAll(() => configureEntityFieldEncryption(createTestEnvelopeCipher()));
  afterAll(() => configureEntityFieldEncryption(undefined));

  test("boot-validates without composeAuthStack and adds a sidebar entry with nav", () => {
    const accountSecurity = createAccountSecurityFeature({ nav: { order: 90 } });
    expect(() =>
      validateBoot([
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthFoundationFeature(),
        createPersonalAccessTokensFeature({ scopes: {} }),
        createSessionsFeature(),
        mfaFeature,
        accountSecurity,
      ]),
    ).not.toThrow();
    expect(Object.values(accountSecurity.navs).map((nav) => nav.screen)).toEqual([
      ACCOUNT_SECURITY_SCREEN_QN,
    ]);
  });
});
