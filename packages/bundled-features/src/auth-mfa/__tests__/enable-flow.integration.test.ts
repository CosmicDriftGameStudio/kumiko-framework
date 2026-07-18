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

describe("enable-confirm burns the setup token on first success", () => {
  test("replaying the same setup token after a disable does not silently re-enable MFA", async () => {
    const user = createTestUser({ id: "setup-token-replay-1", roles: ["User"] });

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "replay@example.com" },
      user,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const code = currentTotpCode(base32Decode(secretParam));

    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code },
      user,
    );
    await stack.http.writeOk(AuthMfaHandlers.disable, { code }, user);

    // Same setupToken + a still-computable code for the disabled secret —
    // without burning the token on first confirm this would re-create the
    // row with the secret the user just discarded.
    const replay = await stack.http.writeErr(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(base32Decode(secretParam)) },
      user,
    );
    expectErrorIncludes(replay, "invalid_setup_token");

    const after = await stack.http.queryOk<{ enabled: boolean }>(AuthMfaQueries.status, {}, user);
    expect(after.enabled).toBe(false);
  });

  test("a second confirm of the same setup token (already enabled) is rejected, not a raw db error", async () => {
    const user = createTestUser({ id: "setup-token-double-confirm-1", roles: ["User"] });

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "double@example.com" },
      user,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const code = currentTotpCode(base32Decode(secretParam));

    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code },
      user,
    );
    const second = await stack.http.writeErr(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(base32Decode(secretParam)) },
      user,
    );
    expectErrorIncludes(second, "invalid_setup_token");
  });

  test("a fresh setup token confirmed while already enabled is rejected as mfa_already_enabled", async () => {
    const user = createTestUser({ id: "already-enabled-fresh-token-1", roles: ["User"] });

    const firstStart = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "already-enabled@example.com" },
      user,
    );
    // Requested before the first confirm — enable-start itself rejects with
    // mfa_already_enabled once a row exists, so a fresh token can only be
    // minted while the user is still unenrolled. Its expiresAtMs differs
    // from firstStart's, so burnToken() (keyed on purpose+userId+expiresAtMs)
    // treats it as fresh rather than a replay when confirmed below — the
    // only way this confirm reaches findUserMfaRow's existing-row check
    // (the sole path to mfaAlreadyEnabled()) instead of invalid_setup_token.
    const secondStart = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "already-enabled@example.com" },
      user,
    );
    const firstSecret =
      new URLSearchParams(firstStart.otpauthUri.split("?")[1]).get("secret") ?? "";
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: firstStart.setupToken, code: currentTotpCode(base32Decode(firstSecret)) },
      user,
    );

    const secondSecret =
      new URLSearchParams(secondStart.otpauthUri.split("?")[1]).get("secret") ?? "";
    const second = await stack.http.writeErr(
      AuthMfaHandlers.enableConfirm,
      { setupToken: secondStart.setupToken, code: currentTotpCode(base32Decode(secondSecret)) },
      user,
    );
    expectErrorIncludes(second, "mfa_already_enabled");
  });

  // Not part of the mfa_already_enabled coverage above — this documents a
  // separate, already-tracked gap: when both enable-confirms are truly
  // concurrent, findUserMfaRow's existing-row check can't see the other
  // request's uncommitted row, so the DB's userId+tenantId unique index
  // rejects the loser with a raw `unique_violation` instead of the
  // friendly mfaAlreadyEnabled() error. No duplicate row is ever created
  // (the invariant this test asserts), but the error surfaced to the
  // client leaks a DB-internal code. Same class of gap as pr-review
  // kumiko-framework#952 idx2 (needs-framework-savepoint-primitive) —
  // tracked there, not fixed here.
  test("two concurrent enable-confirms for the same user never create two rows, 20x", async () => {
    for (let i = 0; i < 20; i++) {
      const user = createTestUser({ id: `concurrent-enable-${i}`, roles: ["User"] });

      const [startA, startB] = await Promise.all([
        stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
          AuthMfaHandlers.enableStart,
          { accountLabel: `concurrent-${i}@example.com` },
          user,
        ),
        stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
          AuthMfaHandlers.enableStart,
          { accountLabel: `concurrent-${i}@example.com` },
          user,
        ),
      ]);
      const secretA = new URLSearchParams(startA.otpauthUri.split("?")[1]).get("secret") ?? "";
      const secretB = new URLSearchParams(startB.otpauthUri.split("?")[1]).get("secret") ?? "";

      const [resA, resB] = await Promise.all([
        stack.http.write(
          AuthMfaHandlers.enableConfirm,
          { setupToken: startA.setupToken, code: currentTotpCode(base32Decode(secretA)) },
          user,
        ),
        stack.http.write(
          AuthMfaHandlers.enableConfirm,
          { setupToken: startB.setupToken, code: currentTotpCode(base32Decode(secretB)) },
          user,
        ),
      ]);
      const bodies = (await Promise.all([resA.json(), resB.json()])) as Array<{
        isSuccess?: boolean;
        error?: { code?: string };
      }>;

      expect(bodies.filter((b) => b.isSuccess === true).length).toBe(1);
      expect(bodies.filter((b) => b.isSuccess !== true).length).toBe(1);
    }
  });
});
