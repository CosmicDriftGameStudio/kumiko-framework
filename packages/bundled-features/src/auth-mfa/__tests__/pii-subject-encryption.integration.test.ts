// Regression test for a real crash found via manual browser testing in a
// consumer app (kumiko-studio) that mounts the full GDPR/user-data-rights
// stack: totpSecret and recoveryCodes are both `encrypted: true` +
// `userOwned` (schema/user-mfa.ts) — the SECOND layer (per-subject
// crypto-shredding, entity-field-encryption.ts's sibling pipeline) only
// activates when `configurePiiSubjectKms` has been called, which none of
// the other auth-mfa integration tests do. That gap let a real bug ship:
// recoveryCodes used to be a `createJsonbField` (an object, not a string),
// and `encryptPiiFieldValues` throws "PII field must be a string" for any
// non-string userOwned field. enable-confirm failed for EVERY real deployment
// with crypto-shredding configured, while every test here stayed green.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { base32Decode } from "../base32";
import { AuthMfaHandlers } from "../constants";
import { createAuthMfaFeature } from "../feature";
import { userMfaEntity } from "../schema/user-mfa";
import { currentTotpCode } from "../totp";

let stack: TestStack;

const SETUP_TOKEN_SECRET = "test-setup-token-secret-do-not-use-in-prod";

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher();
  configureEntityFieldEncryption(encryption);
  const resolver = createConfigResolver({ cipher: encryption });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createAuthMfaFeature({
        setupTokenSecret: SETUP_TOKEN_SECRET,
        issuer: "Kumiko Test",
        challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
      }),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

// The second, independent encryption layer — same activation recipe as
// crypto-shredding/__tests__/forget-subject.integration.test.ts.
beforeEach(() => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

describe("with per-subject PII crypto-shredding active", () => {
  test("enable-confirm succeeds and persists both totpSecret and recoveryCodes", async () => {
    const user = createTestUser({ id: "pii-enable-1", roles: ["User"] });

    const start = await stack.http.writeOk<{
      setupToken: string;
      otpauthUri: string;
      recoveryCodes: string[];
    }>(AuthMfaHandlers.enableStart, { accountLabel: "pii-enable@example.com" }, user);

    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);

    const confirmed = await stack.http.writeOk<{ enabled: boolean }>(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      user,
    );
    expect(confirmed.enabled).toBe(true);

    // recoveryCodes round-trips through both encryption layers correctly —
    // a recovery code (not just the TOTP code) still authenticates.
    const disableRes = await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: start.recoveryCodes[0] },
      user,
    );
    expect(disableRes.disabled).toBe(true);
  });

  test("regenerate-recovery re-encrypts the new codes without crashing", async () => {
    const user = createTestUser({ id: "pii-regen-1", roles: ["User"] });

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "pii-regen@example.com" },
      user,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      user,
    );

    const regenerated = await stack.http.writeOk<{ recoveryCodes: string[] }>(
      AuthMfaHandlers.regenerateRecovery,
      { code: currentTotpCode(secret) },
      user,
    );
    expect(regenerated.recoveryCodes).toHaveLength(8);

    const disableRes = await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: regenerated.recoveryCodes[0] },
      user,
    );
    expect(disableRes.disabled).toBe(true);
  });
});
