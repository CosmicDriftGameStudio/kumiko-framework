import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  type AuthMfaFeatureOptions,
  AuthMfaQueries,
  MFA_DISABLE_SCREEN_ID,
  MFA_ENABLE_SCREEN_ID,
  MFA_REGENERATE_RECOVERY_SCREEN_ID,
} from "../auth-mfa";
import { SESSION_MINE_SCREEN_ID } from "../sessions";

export const ACCOUNT_SECURITY_SCREEN_ID = "account-security";

export const mfaStatusVisibility = { query: AuthMfaQueries.status, field: "enabled" } as const;

export const testAuthMfaOptions: AuthMfaFeatureOptions = {
  setupTokenSecret: "test-setup-token-secret-do-not-use-in-prod",
  issuer: "Kumiko Test",
  challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
};

export const accountSecurityFeature = defineFeature("account-security", (r) => {
  r.requires("sessions");
  r.requires("auth-mfa");
  r.screen({
    id: ACCOUNT_SECURITY_SCREEN_ID,
    type: "dashboard",
    // Test fixture demonstrating composition (fw#2841) — a real app would
    // nav this, but that's out of scope here (fw akte-bedienkonzept-2 V1).
    dormant: true,
    panels: [
      {
        kind: "screen",
        id: "mfa-enable",
        screen: `auth-mfa:screen:${MFA_ENABLE_SCREEN_ID}`,
        visibleWhen: { ...mfaStatusVisibility, eq: false },
      },
      {
        kind: "screen",
        id: "mfa-regenerate",
        screen: `auth-mfa:screen:${MFA_REGENERATE_RECOVERY_SCREEN_ID}`,
        visibleWhen: { ...mfaStatusVisibility, eq: true },
      },
      {
        kind: "screen",
        id: "mfa-disable",
        screen: `auth-mfa:screen:${MFA_DISABLE_SCREEN_ID}`,
        visibleWhen: { ...mfaStatusVisibility, eq: true },
      },
      { kind: "screen", id: "sessions", screen: `sessions:screen:${SESSION_MINE_SCREEN_ID}` },
    ],
  });
  r.translations({
    keys: { "screen:account-security.title": { de: "Kontosicherheit", en: "Account security" } },
  });
});
