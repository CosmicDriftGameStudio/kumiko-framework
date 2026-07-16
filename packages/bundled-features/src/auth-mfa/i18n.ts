// Server-side, boot-validated i18n keys — screen titles/descriptions the
// engine requires every registered r.screen to declare. Distinct from
// web/i18n.ts (the client's free-form UI-string bundle) — see
// personal-access-tokens/i18n.ts for the same split.
type LocalizedString = { readonly de: string; readonly en: string };

export const AUTH_MFA_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:auth-mfa-enable.title": {
    de: "Zwei-Faktor-Authentifizierung",
    en: "Two-factor authentication",
  },
};
