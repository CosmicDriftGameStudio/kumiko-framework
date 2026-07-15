// @runtime client
// Default-Bundles für die auth-mfa Feature-UI. Merged in mit
// authMfaClient() analog zu emailPasswordClient() aus auth-email-password.
// Keys folgen `auth.mfa.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "auth.mfa.verify.title": "Zwei-Faktor-Bestätigung",
    "auth.mfa.verify.subtitle": "Gib den 6-stelligen Code aus deiner Authenticator-App ein.",
    "auth.mfa.verify.code": "Code",
    "auth.mfa.verify.submit": "Bestätigen",
    "auth.mfa.verify.submitting": "…",
    "auth.mfa.errors.invalidCode": "Ungültiger Code. Bitte erneut versuchen.",
    "auth.mfa.errors.challengeExpired": "Die Anmeldung ist abgelaufen. Bitte erneut einloggen.",
    "auth.mfa.errors.tooManyAttempts": "Zu viele Fehlversuche. Bitte erneut einloggen.",
    "auth.mfa.errors.verifyFailed": "Bestätigung fehlgeschlagen.",
  },
  en: {
    "auth.mfa.verify.title": "Two-factor verification",
    "auth.mfa.verify.subtitle": "Enter the 6-digit code from your authenticator app.",
    "auth.mfa.verify.code": "Code",
    "auth.mfa.verify.submit": "Verify",
    "auth.mfa.verify.submitting": "…",
    "auth.mfa.errors.invalidCode": "Invalid code. Please try again.",
    "auth.mfa.errors.challengeExpired": "Your sign-in has expired. Please sign in again.",
    "auth.mfa.errors.tooManyAttempts": "Too many failed attempts. Please sign in again.",
    "auth.mfa.errors.verifyFailed": "Verification failed.",
  },
};

export { mergeTranslations } from "@cosmicdrift/kumiko-renderer";
