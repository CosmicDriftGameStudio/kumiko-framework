// Server-registered so the framework projects these keys into the client bundle.

type LocalizedString = { readonly de: string; readonly en: string };

export const ACCOUNT_SECURITY_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:account-security.title": { de: "Konto & Sicherheit", en: "Account & Security" },
  "account-security:nav.accountSecurity": { de: "Konto & Sicherheit", en: "Account & Security" },
};
