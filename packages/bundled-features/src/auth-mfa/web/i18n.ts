// @runtime client
// Default-Bundles für die auth-mfa Feature-UI. Merged in mit
// authMfaClient() analog zu emailPasswordClient() aus auth-email-password.
// Keys folgen `auth.mfa.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "screen:auth-mfa-enable.title": "Zwei-Faktor-Authentifizierung",
    "auth.mfa.verify.title": "Zwei-Faktor-Bestätigung",
    "auth.mfa.verify.subtitle": "Gib den 6-stelligen Code aus deiner Authenticator-App ein.",
    "auth.mfa.verify.code": "Code",
    "auth.mfa.verify.submit": "Bestätigen",
    "auth.mfa.verify.submitting": "…",
    "auth.mfa.verify.backToLogin": "Zurück zum Login",
    "auth.mfa.errors.invalidCode": "Ungültiger Code. Bitte erneut versuchen.",
    "auth.mfa.errors.challengeExpired": "Die Anmeldung ist abgelaufen. Bitte erneut einloggen.",
    "auth.mfa.errors.tooManyAttempts": "Zu viele Fehlversuche. Bitte erneut einloggen.",
    "auth.mfa.errors.verifyFailed": "Bestätigung fehlgeschlagen.",
    "auth.mfa.errors.mfaAlreadyEnabled": "Zwei-Faktor-Authentifizierung ist bereits aktiv.",
    "auth.mfa.errors.mfaNotEnabled": "Zwei-Faktor-Authentifizierung ist nicht aktiv.",
    "auth.mfa.errors.invalidSetupToken": "Die Einrichtung ist abgelaufen. Bitte erneut starten.",
    "auth.mfa.errors.setupFailed": "Einrichtung fehlgeschlagen. Bitte erneut versuchen.",
    "auth.mfa.errors.invalidRecoveryCode": "Ungültiger Recovery-Code.",
    "auth.mfa.enable.title": "Zwei-Faktor-Authentifizierung",
    "auth.mfa.enable.intro":
      "Schütze dein Konto zusätzlich mit einer Authenticator-App (z.B. Google Authenticator, 1Password).",
    "auth.mfa.enable.start": "Einrichtung starten",
    "auth.mfa.enable.scanTitle": "QR-Code scannen",
    "auth.mfa.enable.manualEntry": "Oder manuell eingeben:",
    "auth.mfa.enable.recoveryTitle": "Recovery-Codes",
    "auth.mfa.enable.recoveryHint":
      "Speichere diese Codes an einem sicheren Ort. Sie werden nur dieses eine Mal angezeigt und erlauben dir den Zugriff, falls du dein Gerät verlierst.",
    "auth.mfa.enable.acknowledge": "Ich habe die Recovery-Codes gespeichert.",
    "auth.mfa.enable.code": "Code aus der Authenticator-App",
    "auth.mfa.enable.cancel": "Abbrechen",
    "auth.mfa.enable.confirm": "Aktivieren",
    "auth.mfa.enable.success": "Zwei-Faktor-Authentifizierung ist jetzt aktiv.",
    "auth.mfa.disable.title": "Zwei-Faktor-Authentifizierung deaktivieren",
    "auth.mfa.disable.description":
      "Bestätige mit einem Code aus deiner Authenticator-App oder einem Recovery-Code. Dein Konto ist danach nur noch durch dein Passwort geschützt.",
    "auth.mfa.disable.code": "Code aus der Authenticator-App oder Recovery-Code",
    "auth.mfa.disable.confirm": "Deaktivieren",
    "auth.mfa.disable.cancel": "Abbrechen",
    "auth.mfa.disable.trigger": "Zwei-Faktor-Authentifizierung deaktivieren",
    "auth.mfa.regenerate.title": "Neue Recovery-Codes erzeugen",
    "auth.mfa.regenerate.description":
      "Bestätige mit einem Code aus deiner Authenticator-App. Alle bisherigen Recovery-Codes werden sofort ungültig.",
    "auth.mfa.regenerate.code": "Code aus der Authenticator-App",
    "auth.mfa.regenerate.confirm": "Neu erzeugen",
    "auth.mfa.regenerate.cancel": "Abbrechen",
    "auth.mfa.regenerate.trigger": "Neue Recovery-Codes erzeugen",
    "auth.mfa.regenerate.newCodesTitle": "Deine neuen Recovery-Codes",
    "auth.mfa.regenerate.newCodesHint":
      "Speichere diese Codes an einem sicheren Ort. Die alten Codes funktionieren ab sofort nicht mehr.",
    "auth.mfa.regenerate.acknowledge": "Ich habe die neuen Recovery-Codes gespeichert.",
    "auth.mfa.regenerate.done": "Fertig",
  },
  en: {
    "screen:auth-mfa-enable.title": "Two-factor authentication",
    "auth.mfa.verify.title": "Two-factor verification",
    "auth.mfa.verify.subtitle": "Enter the 6-digit code from your authenticator app.",
    "auth.mfa.verify.code": "Code",
    "auth.mfa.verify.submit": "Verify",
    "auth.mfa.verify.submitting": "…",
    "auth.mfa.verify.backToLogin": "Back to login",
    "auth.mfa.errors.invalidCode": "Invalid code. Please try again.",
    "auth.mfa.errors.challengeExpired": "Your sign-in has expired. Please sign in again.",
    "auth.mfa.errors.tooManyAttempts": "Too many failed attempts. Please sign in again.",
    "auth.mfa.errors.verifyFailed": "Verification failed.",
    "auth.mfa.errors.mfaAlreadyEnabled": "Two-factor authentication is already enabled.",
    "auth.mfa.errors.mfaNotEnabled": "Two-factor authentication is not enabled.",
    "auth.mfa.errors.invalidSetupToken": "Setup expired. Please start again.",
    "auth.mfa.errors.setupFailed": "Setup failed. Please try again.",
    "auth.mfa.errors.invalidRecoveryCode": "Invalid recovery code.",
    "auth.mfa.enable.title": "Two-factor authentication",
    "auth.mfa.enable.intro":
      "Add an extra layer of protection with an authenticator app (e.g. Google Authenticator, 1Password).",
    "auth.mfa.enable.start": "Start setup",
    "auth.mfa.enable.scanTitle": "Scan the QR code",
    "auth.mfa.enable.manualEntry": "Or enter manually:",
    "auth.mfa.enable.recoveryTitle": "Recovery codes",
    "auth.mfa.enable.recoveryHint":
      "Save these codes somewhere safe. They're shown only this once and let you back in if you lose your device.",
    "auth.mfa.enable.acknowledge": "I've saved my recovery codes.",
    "auth.mfa.enable.code": "Code from your authenticator app",
    "auth.mfa.enable.cancel": "Cancel",
    "auth.mfa.enable.confirm": "Enable",
    "auth.mfa.enable.success": "Two-factor authentication is now enabled.",
    "auth.mfa.disable.title": "Disable two-factor authentication",
    "auth.mfa.disable.description":
      "Confirm with a code from your authenticator app or a recovery code. Your account will then be protected by your password alone.",
    "auth.mfa.disable.code": "Code from your authenticator app or a recovery code",
    "auth.mfa.disable.confirm": "Disable",
    "auth.mfa.disable.cancel": "Cancel",
    "auth.mfa.disable.trigger": "Disable two-factor authentication",
    "auth.mfa.regenerate.title": "Generate new recovery codes",
    "auth.mfa.regenerate.description":
      "Confirm with a code from your authenticator app. All existing recovery codes stop working immediately.",
    "auth.mfa.regenerate.code": "Code from your authenticator app",
    "auth.mfa.regenerate.confirm": "Generate new codes",
    "auth.mfa.regenerate.cancel": "Cancel",
    "auth.mfa.regenerate.trigger": "Generate new recovery codes",
    "auth.mfa.regenerate.newCodesTitle": "Your new recovery codes",
    "auth.mfa.regenerate.newCodesHint":
      "Save these codes somewhere safe. The old codes stop working immediately.",
    "auth.mfa.regenerate.acknowledge": "I've saved my new recovery codes.",
    "auth.mfa.regenerate.done": "Done",
  },
};

export { mergeTranslations } from "@cosmicdrift/kumiko-renderer";
