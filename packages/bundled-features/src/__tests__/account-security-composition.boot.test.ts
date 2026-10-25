import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  ACCOUNT_SECURITY_SCREEN_ID,
  ACCOUNT_SECURITY_SCREEN_QN,
  createAccountSecurityFeature,
} from "../account-security/index.ts";
import { createAuthFoundationFeature } from "../auth-foundation/index.ts";
import {
  AuthMfaHandlers,
  createAuthMfaFeature,
  MFA_DISABLE_SCREEN_ID,
  MFA_ENABLE_SCREEN_ID,
  MFA_REGENERATE_RECOVERY_SCREEN_ID,
} from "../auth-mfa/index.ts";
import { createConfigFeature } from "../config/feature.ts";
import { createPersonalAccessTokensFeature } from "../personal-access-tokens/index.ts";
import {
  createSessionsFeature,
  SESSION_MINE_SCREEN_ID,
  SessionHandlers,
} from "../sessions/index.ts";
import { createTenantFeature } from "../tenant/index.ts";
import { createUserFeature } from "../user/feature.ts";
import { testAuthMfaOptions } from "./auth-mfa-test-options.ts";

function bootFeatures() {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthFoundationFeature(),
    createPersonalAccessTokensFeature({ scopes: {} }),
    createSessionsFeature(),
    createAuthMfaFeature(testAuthMfaOptions),
  ];
}

describe("account-security composed from bundled screens", () => {
  // auth-mfa's user-mfa entity has encrypted fields — validateBoot probes for a cipher.
  beforeAll(() => configureEntityFieldEncryption(createTestEnvelopeCipher()));
  afterAll(() => configureEntityFieldEncryption(undefined));

  test("boot-validates as a dashboard of screen panels", () => {
    expect(() => validateBoot([...bootFeatures(), createAccountSecurityFeature()])).not.toThrow();
  });

  test("defaults to a dormant screen open to every signed-in user, without nav", () => {
    const feature = createAccountSecurityFeature();
    const screen = feature.screens[ACCOUNT_SECURITY_SCREEN_ID];
    expect(screen?.dormant).toBe(true);
    expect(screen?.access).toEqual({
      openToAll: { reason: "signed-in users manage their own account security" },
    });
    expect(Object.keys(feature.navs)).toEqual([]);
  });

  test("nav option registers a sidebar entry and wakes the screen; access narrows it", () => {
    const feature = createAccountSecurityFeature({
      access: { roles: ["Admin", "Editor"] },
      nav: { order: 40 },
    });
    const screen = feature.screens[ACCOUNT_SECURITY_SCREEN_ID];
    expect(screen?.dormant).toBe(false);
    expect(screen?.access).toEqual({ roles: ["Admin", "Editor"] });
    const nav = Object.values(feature.navs)[0];
    expect(nav?.screen).toBe(ACCOUNT_SECURITY_SCREEN_QN);
    expect(nav?.order).toBe(40);
    expect(() =>
      validateBoot([...bootFeatures(), createAccountSecurityFeature({ nav: {} })]),
    ).not.toThrow();
  });

  test("the self-service screens are open to every signed-in user", () => {
    const [, , , , , sessions, mfa] = bootFeatures();
    const screensWithReason: ReadonlyArray<{
      readonly screen: { readonly access?: unknown } | undefined;
      readonly reason: string;
    }> = [
      {
        screen: sessions?.screens[SESSION_MINE_SCREEN_ID],
        reason:
          "each signed-in user views and revokes only their own sessions, mirroring the mine/revoke handlers",
      },
      {
        screen: mfa?.screens[MFA_ENABLE_SCREEN_ID],
        reason:
          "each signed-in user may enroll their own account in MFA, mirroring the enable-start handler",
      },
      {
        screen: mfa?.screens[MFA_DISABLE_SCREEN_ID],
        reason: "each signed-in user may turn off their own MFA, mirroring the disable handler",
      },
      {
        screen: mfa?.screens[MFA_REGENERATE_RECOVERY_SCREEN_ID],
        reason:
          "each signed-in user may regenerate their own recovery codes, mirroring the regenerate-recovery handler",
      },
    ];
    for (const { screen, reason } of screensWithReason) {
      expect(screen?.access).toEqual({ openToAll: { reason } });
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
