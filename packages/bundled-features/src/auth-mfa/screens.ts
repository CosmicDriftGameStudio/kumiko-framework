import {
  type ActionFormScreenDefinition,
  i18nKey,
  type SecretMintScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AuthMfaHandlers,
  MFA_DISABLE_SCREEN_ID,
  MFA_ENABLE_SCREEN_ID,
  MFA_REGENERATE_RECOVERY_SCREEN_ID,
} from "./constants";

// Declarative TOTP-enrollment screen: mint (no input) -> reveal QR/secret/
// recovery-codes -> confirm with a 6-digit code. `setupToken` is carried
// from the mint payload into the confirm payload but never listed in
// `reveal.fields` — it is threaded through, not shown.
export const mfaEnableScreen: SecretMintScreenDefinition = {
  id: MFA_ENABLE_SCREEN_ID,
  type: "secretMint",
  handler: AuthMfaHandlers.enableStart,
  fields: {},
  layout: { sections: [] },
  submitLabel: i18nKey("mfa.enable.start"),
  access: {
    openToAll: {
      reason:
        "each signed-in user may enroll their own account in MFA, mirroring the enable-start handler",
    },
  },
  // Reached only via a direct link from account settings, never from a
  // list — no nav area to resolve in isolation.
  dormant: true,
  description:
    "Self-service screen where a signed-in user enrolls in TOTP two-factor authentication: it shows the QR code and manual secret, reveals the recovery codes once, and confirms enrollment with a code from their authenticator app.",
  reveal: {
    title: i18nKey("mfa.enable.reveal.title"),
    warning: i18nKey("mfa.enable.reveal.warning"),
    fields: [
      {
        field: "otpauthUri",
        label: i18nKey("mfa.enable.reveal.qr"),
        display: "qr",
        copyable: false,
      },
      {
        field: "totpSecret",
        label: i18nKey("mfa.enable.reveal.secret"),
        display: "code",
        copyable: true,
      },
      {
        field: "recoveryCodes",
        label: i18nKey("mfa.enable.reveal.recoveryCodes"),
        display: "list",
        copyable: true,
      },
    ],
  },
  confirm: {
    handler: AuthMfaHandlers.enableConfirm,
    fields: {
      code: { type: "text", required: true, maxLength: 6 },
    },
    layout: { sections: [{ fields: ["code"] }] },
    carry: ["setupToken"],
    submitLabel: i18nKey("mfa.enable.confirm.submit"),
    doneMessage: i18nKey("mfa.enable.confirm.done"),
  },
};

// Either a 6-digit TOTP code or a 9-char recovery code proves possession —
// same bounds as the disable/regenerate-recovery handler schemas.
const possessionCodeField = { type: "text", required: true, maxLength: 9 } as const;

export const mfaDisableScreen: ActionFormScreenDefinition = {
  id: MFA_DISABLE_SCREEN_ID,
  type: "actionForm",
  handler: AuthMfaHandlers.disable,
  fields: { code: possessionCodeField },
  layout: { sections: [{ fields: ["code"] }] },
  submitLabel: i18nKey("mfa.disable.submit"),
  submitStyle: "danger",
  cancelTarget: false,
  access: {
    openToAll: {
      reason: "each signed-in user may turn off their own MFA, mirroring the disable handler",
    },
  },
  // Reached only via a direct link from account settings, never from a
  // list — no nav area to resolve in isolation.
  dormant: true,
  description:
    "Self-service screen where a signed-in user turns two-factor authentication off by entering a code from their authenticator app or a recovery code; their other sessions and access tokens are signed out.",
};

export const mfaRegenerateRecoveryScreen: SecretMintScreenDefinition = {
  id: MFA_REGENERATE_RECOVERY_SCREEN_ID,
  type: "secretMint",
  handler: AuthMfaHandlers.regenerateRecovery,
  fields: { code: possessionCodeField },
  layout: { sections: [{ fields: ["code"] }] },
  submitLabel: i18nKey("mfa.regenerate.submit"),
  cancelTarget: false,
  access: {
    openToAll: {
      reason:
        "each signed-in user may regenerate their own recovery codes, mirroring the regenerate-recovery handler",
    },
  },
  // Reached only via a direct link from account settings, never from a
  // list — no nav area to resolve in isolation.
  dormant: true,
  description:
    "Self-service screen where a signed-in user with two-factor authentication replaces all recovery codes after confirming with a current code; the new codes are shown once.",
  reveal: {
    title: i18nKey("mfa.regenerate.reveal.title"),
    warning: i18nKey("mfa.regenerate.reveal.warning"),
    fields: [
      {
        field: "recoveryCodes",
        label: i18nKey("mfa.enable.reveal.recoveryCodes"),
        display: "list",
        copyable: true,
      },
    ],
  },
};
