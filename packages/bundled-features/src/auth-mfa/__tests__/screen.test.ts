import { describe, expect, test } from "bun:test";
import { fieldLabelKey } from "@cosmicdrift/kumiko-headless";
import { AuthMfaHandlers, MFA_ENABLE_SCREEN_ID } from "../constants";
import { createAuthMfaFeature } from "../feature";
import { AUTH_MFA_FEATURE_I18N } from "../i18n";
import { mfaEnableScreen } from "../screens";

const feature = createAuthMfaFeature({
  setupTokenSecret: "test-setup-token-secret-do-not-use-in-prod",
  issuer: "Kumiko Test",
  challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
});

describe("auth-mfa enable screen — declarative secretMint (fw#2838)", () => {
  test("is registered as a secretMint, not a custom screen", () => {
    const screen = feature.screens[MFA_ENABLE_SCREEN_ID];
    expect(screen?.type).toBe("secretMint");
    if (screen?.type !== "secretMint") throw new Error("expected a secretMint screen");
    expect(screen.handler).toBe(AuthMfaHandlers.enableStart);
  });

  test("reveal.fields is exactly otpauthUri, totpSecret, recoveryCodes — never setupToken", () => {
    const fields = mfaEnableScreen.reveal.fields.map((f) => f.field);
    expect(fields).toEqual(["otpauthUri", "totpSecret", "recoveryCodes"]);
    expect(fields).not.toContain("setupToken");
  });

  test("otpauthUri renders as a QR code and is not copyable; secret and codes are copyable", () => {
    const byField = Object.fromEntries(mfaEnableScreen.reveal.fields.map((f) => [f.field, f]));
    expect(byField["otpauthUri"]).toMatchObject({ display: "qr", copyable: false });
    expect(byField["totpSecret"]).toMatchObject({ display: "code", copyable: true });
    expect(byField["recoveryCodes"]).toMatchObject({ display: "list", copyable: true });
  });

  test("confirm carries exactly setupToken from the mint payload into the code-confirm step", () => {
    const confirm = mfaEnableScreen.confirm;
    expect(confirm?.handler).toBe(AuthMfaHandlers.enableConfirm);
    expect(confirm?.carry).toEqual(["setupToken"]);
    expect(Object.keys(confirm?.fields ?? {})).toEqual(["code"]);
  });

  test("every i18n key the screen references is declared in AUTH_MFA_FEATURE_I18N", () => {
    const referenced = [
      mfaEnableScreen.submitLabel,
      mfaEnableScreen.reveal.title,
      mfaEnableScreen.reveal.warning,
      ...mfaEnableScreen.reveal.fields.map((f) => f.label),
      mfaEnableScreen.confirm?.submitLabel,
      mfaEnableScreen.confirm?.doneMessage,
      fieldLabelKey("auth-mfa", "__action-form__", "code"),
    ].filter((key): key is string => typeof key === "string");

    expect(referenced.length).toBeGreaterThan(0);
    for (const key of referenced) {
      expect(AUTH_MFA_FEATURE_I18N[key]).toBeDefined();
    }
  });
});
