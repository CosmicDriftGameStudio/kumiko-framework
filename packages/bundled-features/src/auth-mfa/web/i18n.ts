// @runtime client
// Default-Bundles für die auth-mfa Feature-UI. Merged in mit
// authMfaClient() analog zu emailPasswordClient() aus auth-email-password.
// Keys folgen `auth.mfa.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "screen:auth-mfa-enable.title": "Two-factor authentication",
    "auth.mfa.verify.title": "Two-factor verification",
    "auth.mfa.verify.subtitle": "Enter the 6-digit code from your authenticator app.",
    "auth.mfa.verify.code": "Code",
    "auth.mfa.verify.submit": "Verify",
    "auth.mfa.verify.submitting": "…",
    "auth.mfa.verify.backToLogin": "Back to login",
    "auth.mfa.errors.invalidCode": "Invalid code. Please try again.",
    "auth.mfa.errors.invalidTotpCode": "Invalid code. Please try again.",
    "auth.mfa.errors.invalidChallengeToken": "Your sign-in has expired. Please sign in again.",
    "auth.mfa.errors.challengeExpired": "Your sign-in has expired. Please sign in again.",
    "auth.mfa.errors.tooManyAttempts": "Too many failed attempts. Please sign in again.",
    "auth.mfa.errors.tooManyAttemptsWithSeconds":
      "Too many failed attempts. Try again in {seconds} seconds, or sign in again.",
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
    "auth.mfa.setup.title": "Two-factor authentication required",
    "auth.mfa.setup.subtitle":
      "Your account requires two-factor authentication. Set it up now to sign in.",
    "auth.mfa.setup.intro":
      "Scan the QR code with an authenticator app (e.g. Google Authenticator, 1Password).",
    "auth.mfa.setup.start": "Start setup",
    "auth.mfa.setup.confirm": "Complete setup",
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
