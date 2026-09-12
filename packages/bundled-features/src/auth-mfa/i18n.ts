// Server-side, boot-validated i18n keys — screen titles/descriptions the
// engine requires every registered r.screen to declare. Distinct from
// web/i18n.ts (the client's free-form UI-string bundle) — see
// personal-access-tokens/i18n.ts for the same split.
type LocalizedString = { readonly en: string };

export const AUTH_MFA_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:auth-mfa-enable.title": {
    en: "Two-factor authentication",
  },

  "mfa.enable.start": { en: "Start setup" },

  "mfa.enable.reveal.title": { en: "Set up your authenticator app" },
  "mfa.enable.reveal.warning": {
    en: "Save your recovery codes now — for security everything on this screen is shown only this once.",
  },
  "mfa.enable.reveal.qr": { en: "Scan this QR code" },
  "mfa.enable.reveal.secret": { en: "Or enter this code manually" },
  "mfa.enable.reveal.recoveryCodes": { en: "Recovery codes" },

  "mfa.enable.confirm.submit": { en: "Enable" },
  "mfa.enable.confirm.done": { en: "Two-factor authentication is now enabled." },

  // Field label for the confirm step's pseudo-entity (`__action-form__`, see
  // action-form-shim.ts) — required by the i18n boot-validator
  // (requiredKeysFromScreen); the declarative renderer resolves this through
  // the schema payload, not a client component's t().
  "auth-mfa:entity:__action-form__:field:code": { en: "Code from your authenticator app" },
};
