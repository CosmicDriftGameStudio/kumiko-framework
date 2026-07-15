import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
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
import { userSessionEntity, userSessionTable } from "../../sessions/schema/user-session";
import { createSessionCallbacks } from "../../sessions/session-callbacks";
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { base32Decode } from "../base32";
import { AuthMfaHandlers } from "../constants";
import { bindMfaRevokeAllOtherSessionsFromFeature, createAuthMfaFeature } from "../feature";
import { userMfaEntity } from "../schema/user-mfa";
import { currentTotpCode } from "../totp";

// Enable/disable/regenerate are security-relevant state changes on the
// account — every OTHER live session must be signed out (stolen-session
// defense), but the session that performed the change must survive.

let stack: TestStack;
let sessionCallbacks: ReturnType<typeof createSessionCallbacks>;

const SETUP_TOKEN_SECRET = "test-mfa-setup-secret-at-least-32-bytes-long!!";

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher();
  configureEntityFieldEncryption(encryption);
  const resolver = createConfigResolver({ cipher: encryption });
  const mfaFeature = createAuthMfaFeature({
    setupTokenSecret: SETUP_TOKEN_SECRET,
    issuer: "Kumiko Test",
    challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
  });
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), mfaFeature],
    extraContext: { configResolver: resolver, configEncryption: encryption },
  });

  sessionCallbacks = createSessionCallbacks({ db: stack.db });
  const bind = bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature);
  if (!bind) throw new Error("auth-mfa did not export bindRevokeAllOtherSessions");
  bind(sessionCallbacks.sessionRevokeAllOthers);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userSessionTable.tableName}"`);
});

describe("session auto-revoke on MFA state changes", () => {
  test("enable-confirm revokes every OTHER session but keeps the caller's", async () => {
    const userId = "revoke-enable-1";
    const currentSid = await sessionCallbacks.sessionCreator(createTestUser({ id: userId }), {
      ip: "127.0.0.1",
      userAgent: "test",
    });
    const otherSid = await sessionCallbacks.sessionCreator(createTestUser({ id: userId }), {
      ip: "127.0.0.1",
      userAgent: "test",
    });

    const user = createTestUser({ id: userId, sid: currentSid });
    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: `${userId}@example.com` },
      user,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      user,
    );

    expect(await sessionCallbacks.sessionChecker(currentSid, userId)).toBe("live");
    expect(await sessionCallbacks.sessionChecker(otherSid, userId)).toBe("revoked");
  });

  test("disable revokes every OTHER session but keeps the caller's", async () => {
    const userId = "revoke-disable-1";
    const setupUser = createTestUser({ id: userId });
    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: `${userId}@example.com` },
      setupUser,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      setupUser,
    );

    const currentSid = await sessionCallbacks.sessionCreator(setupUser, {
      ip: "127.0.0.1",
      userAgent: "test",
    });
    const otherSid = await sessionCallbacks.sessionCreator(setupUser, {
      ip: "127.0.0.1",
      userAgent: "test",
    });

    const caller = createTestUser({ id: userId, sid: currentSid });
    await stack.http.writeOk<{ disabled: boolean }>(
      AuthMfaHandlers.disable,
      { code: currentTotpCode(secret) },
      caller,
    );

    expect(await sessionCallbacks.sessionChecker(currentSid, userId)).toBe("live");
    expect(await sessionCallbacks.sessionChecker(otherSid, userId)).toBe("revoked");
  });

  test("a failed disable attempt does NOT revoke any session", async () => {
    const userId = "revoke-fail-1";
    const setupUser = createTestUser({ id: userId });
    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: `${userId}@example.com` },
      setupUser,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      setupUser,
    );

    const currentSid = await sessionCallbacks.sessionCreator(setupUser, {
      ip: "127.0.0.1",
      userAgent: "test",
    });
    const otherSid = await sessionCallbacks.sessionCreator(setupUser, {
      ip: "127.0.0.1",
      userAgent: "test",
    });

    const caller = createTestUser({ id: userId, sid: currentSid });
    const err = await stack.http.writeErr(AuthMfaHandlers.disable, { code: "000000" }, caller);
    expectErrorIncludes(err, "invalid_totp_code");

    expect(await sessionCallbacks.sessionChecker(currentSid, userId)).toBe("live");
    expect(await sessionCallbacks.sessionChecker(otherSid, userId)).toBe("live");
  });
});
