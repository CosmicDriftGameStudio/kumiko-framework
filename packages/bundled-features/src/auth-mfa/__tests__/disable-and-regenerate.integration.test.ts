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
import { createTenantFeature } from "../../tenant";
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
      createTenantFeature(),
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

// Runs enable-start + enable-confirm for a fresh user and returns the
// user + the live secret so tests can derive current TOTP codes.
async function enableMfaFor(userId: string): Promise<{
  user: ReturnType<typeof createTestUser>;
  secret: Buffer;
  recoveryCodes: string[];
}> {
  const user = createTestUser({ id: userId, roles: ["User"] });
  const start = await stack.http.writeOk<{
    setupToken: string;
    otpauthUri: string;
    recoveryCodes: string[];
  }>(AuthMfaHandlers.enableStart, { accountLabel: `${userId}@example.com` }, user);

  const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
  const secret = base32Decode(secretParam);
  await stack.http.writeOk(
    AuthMfaHandlers.enableConfirm,
    { setupToken: start.setupToken, code: currentTotpCode(secret) },
    user,
  );

  return { user, secret, recoveryCodes: start.recoveryCodes };
}

describe("disable", () => {
  test("a valid TOTP code disables MFA, and a fresh enable-start succeeds afterward", async () => {
    const { user, secret } = await enableMfaFor("disable-totp-1");

    const res = await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: currentTotpCode(secret) },
      user,
    );
    expect(res.disabled).toBe(true);

    const secondStart = await stack.http.writeOk<{ setupToken: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "disable-totp-1@example.com" },
      user,
    );
    expect(secondStart.setupToken).toBeTruthy();
  });

  test("MFA can be fully re-enabled after disable (re-create on a deleted aggregate)", async () => {
    const { user, secret: firstSecret } = await enableMfaFor("disable-reenable-1");

    await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: currentTotpCode(firstSecret) },
      user,
    );

    const restart = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "disable-reenable-1@example.com" },
      user,
    );
    const secretParam = new URLSearchParams(restart.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secondSecret = base32Decode(secretParam);

    const confirm = await stack.http.writeOk<{ enabled: boolean }>(
      AuthMfaHandlers.enableConfirm,
      { setupToken: restart.setupToken, code: currentTotpCode(secondSecret) },
      user,
    );
    expect(confirm.enabled).toBe(true);

    // The re-enabled row is fully usable — a real code disables it again.
    const res = await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: currentTotpCode(secondSecret) },
      user,
    );
    expect(res.disabled).toBe(true);
  });

  test("a valid recovery code also disables MFA", async () => {
    const { user, recoveryCodes } = await enableMfaFor("disable-recovery-1");

    const res = await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: recoveryCodes[0] },
      user,
    );
    expect(res.disabled).toBe(true);
  });

  test("a recovery code typed lowercase and without the dash still matches", async () => {
    const { user, recoveryCodes } = await enableMfaFor("disable-recovery-normalize-1");
    const code = recoveryCodes[0];
    if (code === undefined) throw new Error("test setup produced no recovery code");

    const sloppy = code.toLowerCase().replace("-", "");
    const res = await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: sloppy },
      user,
    );
    expect(res.disabled).toBe(true);
  });

  test("a wrong code is rejected and MFA stays enabled", async () => {
    const { user, secret } = await enableMfaFor("disable-wrong-1");

    const err = await stack.http.writeErr(AuthMfaHandlers.disable, { code: "000000" }, user);
    expectErrorIncludes(err, "invalid_totp_code");

    // Still enabled — a real code still works.
    const res = await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: currentTotpCode(secret) },
      user,
    );
    expect(res.disabled).toBe(true);
  });

  test("disable on a user without MFA is rejected", async () => {
    const user = createTestUser({ id: "disable-never-enabled-1", roles: ["User"] });
    const err = await stack.http.writeErr(AuthMfaHandlers.disable, { code: "123456" }, user);
    expectErrorIncludes(err, "mfa_not_enabled");
  });
});

describe("regenerate-recovery", () => {
  test("issues 8 fresh codes and invalidates the old ones", async () => {
    const { user, secret, recoveryCodes: oldCodes } = await enableMfaFor("regen-1");

    const res = await stack.http.writeOk<{ recoveryCodes: string[] }>(
      AuthMfaHandlers.regenerateRecovery,
      { code: currentTotpCode(secret) },
      user,
    );
    expect(res.recoveryCodes).toHaveLength(8);
    expect(res.recoveryCodes).not.toEqual(oldCodes);

    // An old code no longer works to disable MFA.
    const oldCode = oldCodes[0];
    if (oldCode === undefined) throw new Error("test setup produced no old recovery code");
    const err = await stack.http.writeErr(AuthMfaHandlers.disable, { code: oldCode }, user);
    expectErrorIncludes(err, "invalid_totp_code");

    // A NEW code works.
    const newCode = res.recoveryCodes[0];
    if (newCode === undefined) throw new Error("regenerate produced no new recovery code");
    const disableRes = await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: newCode },
      user,
    );
    expect(disableRes.disabled).toBe(true);
  });

  test("regenerate on a user without MFA is rejected", async () => {
    const user = createTestUser({ id: "regen-never-enabled-1", roles: ["User"] });
    const err = await stack.http.writeErr(
      AuthMfaHandlers.regenerateRecovery,
      { code: "123456" },
      user,
    );
    expectErrorIncludes(err, "mfa_not_enabled");
  });
});
