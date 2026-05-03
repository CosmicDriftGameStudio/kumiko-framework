// @runtime client
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
    "auth.login.forgotPassword": "Passwort vergessen?",
    "auth.errors.invalidCredentials": "E-Mail oder Passwort falsch.",
    "auth.errors.noMembership": "Dieses Konto hat keinen Tenant-Zugang.",
    "auth.errors.accountLocked": "Konto vorübergehend gesperrt.",
    "auth.errors.accountLockedRetry": "Konto gesperrt. Neuer Versuch in {minutes} Minuten.",
    "auth.errors.emailNotVerified": "E-Mail-Adresse noch nicht bestätigt.",
    "auth.errors.rateLimited": "Zu viele Login-Versuche. Bitte kurz warten.",
    "auth.errors.invalidBody": "Ungültige Eingabe.",
    "auth.errors.loginFailed": "Login fehlgeschlagen.",
    "auth.errors.invalidResetToken":
      "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.",
    "auth.errors.invalidVerificationToken": "Der Bestätigungs-Link ist ungültig oder abgelaufen.",
    "auth.errors.invalidSignupToken":
      "Der Aktivierungs-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.",
    "auth.errors.unknownError": "Etwas ist schief gegangen. Bitte erneut versuchen.",
    "auth.forgotPassword.title": "Passwort zurücksetzen",
    "auth.forgotPassword.intro":
      "Gib deine E-Mail-Adresse ein. Falls ein Konto existiert, schicken wir dir einen Reset-Link.",
    "auth.forgotPassword.email": "E-Mail",
    "auth.forgotPassword.submit": "Link anfordern",
    "auth.forgotPassword.submitting": "…",
    "auth.forgotPassword.successTitle": "Mail gesendet",
    "auth.forgotPassword.successBody":
      "Falls die E-Mail in unserem System existiert, ist eine Nachricht mit einem Reset-Link unterwegs. Bitte schau in deinen Posteingang.",
    "auth.forgotPassword.backToLogin": "Zurück zum Login",
    "auth.resetPassword.title": "Neues Passwort setzen",
    "auth.resetPassword.intro": "Wähle ein neues Passwort (mindestens 8 Zeichen).",
    "auth.resetPassword.newPassword": "Neues Passwort",
    "auth.resetPassword.confirmPassword": "Passwort bestätigen",
    "auth.resetPassword.mismatch": "Die Passwörter stimmen nicht überein.",
    "auth.resetPassword.tooShort": "Passwort muss mindestens 8 Zeichen lang sein.",
    "auth.resetPassword.submit": "Passwort speichern",
    "auth.resetPassword.submitting": "…",
    "auth.resetPassword.successTitle": "Passwort gesetzt",
    "auth.resetPassword.successBody": "Du kannst dich jetzt mit deinem neuen Passwort anmelden.",
    "auth.resetPassword.goToLogin": "Zum Login",
    "auth.resetPassword.missingToken":
      "Der Reset-Link enthält keinen Token. Bitte fordere einen neuen an.",
    "auth.verifyEmail.verifying": "E-Mail wird bestätigt …",
    "auth.verifyEmail.successTitle": "E-Mail bestätigt",
    "auth.verifyEmail.successBody": "Danke! Du kannst dich jetzt anmelden.",
    "auth.verifyEmail.errorTitle": "Bestätigung fehlgeschlagen",
    "auth.verifyEmail.errorBody":
      "Der Link ist ungültig oder abgelaufen. Bitte fordere eine neue Bestätigungs-Mail an.",
    "auth.verifyEmail.goToLogin": "Zum Login",
    "auth.verifyEmail.missingToken": "Der Bestätigungs-Link enthält keinen Token.",
    "auth.signup.title": "Account erstellen",
    "auth.signup.intro":
      "Gib deine E-Mail-Adresse ein. Wir schicken dir einen Aktivierungs-Link, mit dem du dein Passwort setzt.",
    "auth.signup.email": "E-Mail",
    "auth.signup.submit": "Aktivierungs-Link senden",
    "auth.signup.submitting": "…",
    "auth.signup.successTitle": "Mail gesendet",
    "auth.signup.successBody":
      "Wir haben dir einen Aktivierungs-Link an deine E-Mail-Adresse geschickt. Klicke ihn an, um dein Passwort zu setzen und dich einzuloggen.",
    "auth.signup.resend": "Mail erneut senden",
    "auth.signup.haveAccount": "Bereits einen Account? Anmelden",
    "auth.signupComplete.title": "Passwort setzen",
    "auth.signupComplete.intro": "Wähle ein Passwort (mindestens 8 Zeichen) für deinen neuen Account.",
    "auth.signupComplete.password": "Passwort",
    "auth.signupComplete.confirmPassword": "Passwort bestätigen",
    "auth.signupComplete.tooShort": "Passwort muss mindestens 8 Zeichen lang sein.",
    "auth.signupComplete.mismatch": "Die Passwörter stimmen nicht überein.",
    "auth.signupComplete.submit": "Account aktivieren",
    "auth.signupComplete.submitting": "…",
    "auth.signupComplete.missingToken":
      "Der Aktivierungs-Link enthält keinen Token. Bitte fordere einen neuen an.",
    "auth.user.menu.label": "Konto",
    "auth.user.menu.logout": "Abmelden",
    "auth.tenant.switcher.label": "Tenant",
    "auth.tenant.switcher.none": "Kein Tenant",
  },
  en: {
    "auth.login.title": "Sign in",
    "auth.login.email": "Email",
    "auth.login.password": "Password",
    "auth.login.submit": "Sign in",
    "auth.login.submitting": "…",
    "auth.login.forgotPassword": "Forgot password?",
    "auth.errors.invalidCredentials": "Invalid email or password.",
    "auth.errors.noMembership": "This account has no tenant access.",
    "auth.errors.accountLocked": "Account temporarily locked.",
    "auth.errors.accountLockedRetry": "Account locked. Try again in {minutes} minutes.",
    "auth.errors.emailNotVerified": "Email address not yet verified.",
    "auth.errors.rateLimited": "Too many login attempts. Please wait briefly.",
    "auth.errors.invalidBody": "Invalid input.",
    "auth.errors.loginFailed": "Login failed.",
    "auth.errors.invalidResetToken": "Link is invalid or expired. Please request a new one.",
    "auth.errors.invalidVerificationToken": "Verification link is invalid or expired.",
    "auth.errors.invalidSignupToken": "Activation link is invalid or expired. Please request a new one.",
    "auth.errors.unknownError": "Something went wrong. Please try again.",
    "auth.forgotPassword.title": "Reset password",
    "auth.forgotPassword.intro":
      "Enter your email. If an account exists, we'll send you a reset link.",
    "auth.forgotPassword.email": "Email",
    "auth.forgotPassword.submit": "Request link",
    "auth.forgotPassword.submitting": "…",
    "auth.forgotPassword.successTitle": "Email sent",
    "auth.forgotPassword.successBody":
      "If your email exists in our system, a reset link is on its way. Please check your inbox.",
    "auth.forgotPassword.backToLogin": "Back to sign in",
    "auth.resetPassword.title": "Set new password",
    "auth.resetPassword.intro": "Choose a new password (at least 8 characters).",
    "auth.resetPassword.newPassword": "New password",
    "auth.resetPassword.confirmPassword": "Confirm password",
    "auth.resetPassword.mismatch": "Passwords do not match.",
    "auth.resetPassword.tooShort": "Password must be at least 8 characters.",
    "auth.resetPassword.submit": "Save password",
    "auth.resetPassword.submitting": "…",
    "auth.resetPassword.successTitle": "Password set",
    "auth.resetPassword.successBody": "You can now sign in with your new password.",
    "auth.resetPassword.goToLogin": "Go to sign in",
    "auth.resetPassword.missingToken": "Reset link is missing a token. Please request a new one.",
    "auth.verifyEmail.verifying": "Verifying email …",
    "auth.verifyEmail.successTitle": "Email verified",
    "auth.verifyEmail.successBody": "Thanks! You can sign in now.",
    "auth.verifyEmail.errorTitle": "Verification failed",
    "auth.verifyEmail.errorBody":
      "Link is invalid or expired. Please request a new verification email.",
    "auth.verifyEmail.goToLogin": "Go to sign in",
    "auth.verifyEmail.missingToken": "Verification link is missing a token.",
    "auth.signup.title": "Create account",
    "auth.signup.intro":
      "Enter your email. We'll send you an activation link to set your password.",
    "auth.signup.email": "Email",
    "auth.signup.submit": "Send activation link",
    "auth.signup.submitting": "…",
    "auth.signup.successTitle": "Email sent",
    "auth.signup.successBody":
      "We've sent you an activation link. Click it to set your password and sign in.",
    "auth.signup.resend": "Send email again",
    "auth.signup.haveAccount": "Already have an account? Sign in",
    "auth.signupComplete.title": "Set password",
    "auth.signupComplete.intro": "Choose a password (at least 8 characters) for your new account.",
    "auth.signupComplete.password": "Password",
    "auth.signupComplete.confirmPassword": "Confirm password",
    "auth.signupComplete.tooShort": "Password must be at least 8 characters.",
    "auth.signupComplete.mismatch": "Passwords do not match.",
    "auth.signupComplete.submit": "Activate account",
    "auth.signupComplete.submitting": "…",
    "auth.signupComplete.missingToken": "Activation link is missing a token. Please request a new one.",
    "auth.user.menu.label": "Account",
    "auth.user.menu.logout": "Sign out",
    "auth.tenant.switcher.label": "Tenant",
    "auth.tenant.switcher.none": "No tenant",
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
