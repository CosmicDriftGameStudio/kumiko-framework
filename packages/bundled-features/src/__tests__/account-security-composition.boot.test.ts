import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { authFoundationFeature } from "../auth-foundation";
import {
  AuthMfaHandlers,
  createAuthMfaFeature,
  MFA_DISABLE_SCREEN_ID,
  MFA_ENABLE_SCREEN_ID,
  MFA_REGENERATE_RECOVERY_SCREEN_ID,
} from "../auth-mfa";
import { createConfigFeature } from "../config/feature";
import { createPersonalAccessTokensFeature } from "../personal-access-tokens";
import { createSessionsFeature, SESSION_MINE_SCREEN_ID, SessionHandlers } from "../sessions";
import { createTenantFeature } from "../tenant";
import { createUserFeature } from "../user/feature";
import { accountSecurityFeature, testAuthMfaOptions } from "./account-security-fixture";

function bootFeatures() {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    authFoundationFeature,
    createPersonalAccessTokensFeature({ scopes: {} }),
    createSessionsFeature(),
    createAuthMfaFeature(testAuthMfaOptions),
  ];
}

describe("account-security composed from bundled screens (fw#2841)", () => {
  // auth-mfa's user-mfa entity has encrypted fields — validateBoot probes for a cipher.
  beforeAll(() => configureEntityFieldEncryption(createTestEnvelopeCipher()));
  afterAll(() => configureEntityFieldEncryption(undefined));

  test("boot-validates as a dashboard of screen panels", () => {
    expect(() => validateBoot([...bootFeatures(), accountSecurityFeature])).not.toThrow();
  });

  test("the self-service screens are open to every signed-in user", () => {
    const [, , , , , sessions, mfa] = bootFeatures();
    const screens = [
      sessions?.screens[SESSION_MINE_SCREEN_ID],
      mfa?.screens[MFA_ENABLE_SCREEN_ID],
      mfa?.screens[MFA_DISABLE_SCREEN_ID],
      mfa?.screens[MFA_REGENERATE_RECOVERY_SCREEN_ID],
    ];
    for (const screen of screens) {
      expect(screen?.access).toEqual({
        openToAll: { reason: "test handler callable by any signed-in test user" },
      });
    }
  });

  test("MFA disable and regenerate-recovery dispatch their handlers with a possession code", () => {
    const mfa = bootFeatures()[6];
    const disable = mfa?.screens[MFA_DISABLE_SCREEN_ID];
    if (disable?.type !== "actionForm") throw new Error("expected an actionForm");
    expect(disable.handler).toBe(AuthMfaHandlers.disable);
    expect(Object.keys(disable.fields)).toEqual(["code"]);

    const regenerate = mfa?.screens[MFA_REGENERATE_RECOVERY_SCREEN_ID];
    if (regenerate?.type !== "secretMint") throw new Error("expected a secretMint");
    expect(regenerate.handler).toBe(AuthMfaHandlers.regenerateRecovery);
    expect(Object.keys(regenerate.fields)).toEqual(["code"]);
    expect(regenerate.reveal.fields.map((f) => f.field)).toEqual(["recoveryCodes"]);
  });

  test("my-sessions hides revoke on the current session and offers revoke-all-others", () => {
    const sessions = bootFeatures()[5];
    const mine = sessions?.screens[SESSION_MINE_SCREEN_ID];
    if (mine?.type !== "projectionList") throw new Error("expected a projectionList");
    const revoke = mine.rowActions?.find((a) => a.id === "revoke");
    if (revoke === undefined || revoke.kind !== "writeHandler") {
      throw new Error("expected a writeHandler revoke action");
    }
    expect(revoke.handler).toBe(SessionHandlers.revoke);
    expect(revoke.visible).toEqual({ field: "current", eq: false });
    const revokeAllOthers = mine.toolbarActions?.find((a) => a.id === "revoke-all-others");
    expect(revokeAllOthers?.kind === "writeHandler" && revokeAllOthers.handler).toBe(
      SessionHandlers.revokeAllOthers,
    );
  });
});
