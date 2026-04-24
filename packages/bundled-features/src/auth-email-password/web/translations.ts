// Default-Bundles für die Feature-UI. Werden vom emailPasswordClient()
// als Fallback-Bundle in den LocaleProvider gehängt — Apps können
// einzelne Keys via `emailPasswordClient({ translations: { de: { ... } } })`
// überschreiben, ohne das ganze Bundle kopieren zu müssen.
//
// Keys folgen dem Schema `auth.<area>.<slug>` — `auth.login.*` für die
// Formular-UI, `auth.errors.*` für Reason-Codes aus dem Login-Handler
// (1:1 gespiegelt zu AuthErrors im server-side Feature).

import type { TranslationsByLocale } from "@kumiko/renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "auth.login.title": "Anmelden",
    "auth.login.email": "E-Mail",
    "auth.login.password": "Passwort",
    "auth.login.submit": "Einloggen",
    "auth.login.submitting": "…",
    "auth.errors.invalidCredentials": "E-Mail oder Passwort falsch.",
    "auth.errors.noMembership": "Dieses Konto hat keinen Tenant-Zugang.",
    "auth.errors.accountLocked": "Konto vorübergehend gesperrt.",
    "auth.errors.accountLockedRetry": "Konto gesperrt. Neuer Versuch in {minutes} Minuten.",
    "auth.errors.emailNotVerified": "E-Mail-Adresse noch nicht bestätigt.",
    "auth.errors.rateLimited": "Zu viele Login-Versuche. Bitte kurz warten.",
    "auth.errors.invalidBody": "Ungültige Eingabe.",
    "auth.errors.loginFailed": "Login fehlgeschlagen.",
  },
  en: {
    "auth.login.title": "Sign in",
    "auth.login.email": "Email",
    "auth.login.password": "Password",
    "auth.login.submit": "Sign in",
    "auth.login.submitting": "…",
    "auth.errors.invalidCredentials": "Invalid email or password.",
    "auth.errors.noMembership": "This account has no tenant access.",
    "auth.errors.accountLocked": "Account temporarily locked.",
    "auth.errors.accountLockedRetry": "Account locked. Try again in {minutes} minutes.",
    "auth.errors.emailNotVerified": "Email address not yet verified.",
    "auth.errors.rateLimited": "Too many login attempts. Please wait briefly.",
    "auth.errors.invalidBody": "Invalid input.",
    "auth.errors.loginFailed": "Login failed.",
  },
};

/** Merged zwei TranslationsByLocale-Maps — der override gewinnt pro Key,
 *  die Locales werden zusammengeführt. Wird von emailPasswordClient()
 *  benutzt, um App-Overrides über die Defaults zu legen. */
export function mergeTranslations(
  base: TranslationsByLocale,
  override: TranslationsByLocale,
): TranslationsByLocale {
  const locales = new Set([...Object.keys(base), ...Object.keys(override)]);
  const merged: Record<string, Record<string, string>> = {};
  for (const locale of locales) {
    merged[locale] = { ...(base[locale] ?? {}), ...(override[locale] ?? {}) };
  }
  return merged;
}
