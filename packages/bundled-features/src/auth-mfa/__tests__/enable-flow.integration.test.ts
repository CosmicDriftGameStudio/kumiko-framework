import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  expectErrorIncludes,
} from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { base32Decode } from "../base32";
import { AuthMfaHandlers, AuthMfaQueries } from "../constants";
import { createAuthMfaFeature } from "../feature";
import { userMfaEntity } from "../schema/user-mfa";
import { currentTotpCode } from "../totp";

let stack: TestStack;

const SETUP_TOKEN_SECRET = "test-setup-token-secret-do-not-use-in-prod";

beforeAll(async () => {
  // totpSecret is `encrypted: true` — needs a cipher configured before any
  // enable-confirm write, same as any other encrypted-entity-field test.
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

describe("enable-start + enable-confirm round trip", () => {
  test("start returns a setup token + otpauth URI + 8 recovery codes", async () => {
    const user = createTestUser({ id: "enable-start-1", roles: ["User"] });

    const res = await stack.http.writeOk<{
      setupToken: string;
      otpauthUri: string;
      recoveryCodes: string[];
    }>(AuthMfaHandlers.enableStart, { accountLabel: "jane@example.com" }, user);

    expect(res.setupToken.split(".").length).toBe(2);
    expect(res.otpauthUri).toStartWith("otpauth://totp/");
    expect(res.otpauthUri).toContain("jane%40example.com");
    expect(res.recoveryCodes).toHaveLength(8);
    // Format XXXX-XXXX
    for (const code of res.recoveryCodes) {
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    }
  });

  test("confirm with the right code enables MFA", async () => {
    const user = createTestUser({ id: "enable-confirm-1", roles: ["User"] });

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "confirm@example.com" },
      user,
    );

    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    const code = currentTotpCode(secret);

    const confirmed = await stack.http.writeOk<{ enabled: boolean }>(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code },
      user,
    );
    expect(confirmed.enabled).toBe(true);

    // Second enable-start now rejects — MFA already enabled for this user.
    const err = await stack.http.writeErr(
      AuthMfaHandlers.enableStart,
      { accountLabel: "confirm@example.com" },
      user,
    );
    expectErrorIncludes(err, "mfa_already_enabled");
  });

  test("confirm with a wrong code is rejected and does not create a row", async () => {
    const user = createTestUser({ id: "enable-confirm-wrong-1", roles: ["User"] });

    const start = await stack.http.writeOk<{ setupToken: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "wrong@example.com" },
      user,
    );

    const err = await stack.http.writeErr(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: "000000" },
      user,
    );
    expectErrorIncludes(err, "invalid_totp_code");

    // MFA is still not enabled — a fresh enable-start succeeds.
    const secondStart = await stack.http.writeOk<{ setupToken: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "wrong@example.com" },
      user,
    );
    expect(secondStart.setupToken).toBeTruthy();
  });

  test("confirm rejects a setup token signed for a different user", async () => {
    const userA = createTestUser({ id: "enable-confirm-cross-a", roles: ["User"] });
    const userB = createTestUser({ id: "enable-confirm-cross-b", roles: ["User"] });

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "cross@example.com" },
      userA,
    );

    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const code = currentTotpCode(base32Decode(secretParam));

    const err = await stack.http.writeErr(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code },
      userB,
    );
    expectErrorIncludes(err, "invalid_setup_token");
  });

  test("status query reflects enrollment before and after enable-confirm", async () => {
    const user = createTestUser({ id: "status-query-1", roles: ["User"] });

    const before = await stack.http.queryOk<{ enabled: boolean }>(AuthMfaQueries.status, {}, user);
    expect(before.enabled).toBe(false);

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "status@example.com" },
      user,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const code = currentTotpCode(base32Decode(secretParam));
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code },
      user,
    );

    const after = await stack.http.queryOk<{ enabled: boolean }>(AuthMfaQueries.status, {}, user);
    expect(after.enabled).toBe(true);
  });
});
