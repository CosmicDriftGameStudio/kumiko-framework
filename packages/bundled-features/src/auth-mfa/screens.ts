import { i18nKey, type SecretMintScreenDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { AuthMfaHandlers, MFA_ENABLE_SCREEN_ID } from "./constants";

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
  access: { openToAll: true },
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
