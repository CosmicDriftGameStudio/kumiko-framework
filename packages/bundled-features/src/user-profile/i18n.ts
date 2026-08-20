// @runtime client
// Default-Bundles für den ProfileScreen. Werden vom userProfileClient()
// als Fallback-Bundle in den LocaleProvider gehängt — Apps überschreiben
// einzelne Keys via `userProfileClient({ translations })`.
// `auth.errors.invalidCredentials` + `user.errors.emailAlreadyExists`
// sind hier gedoppelt, damit der Screen auch ohne die jeweiligen
// Feature-Bundles vollständig übersetzt.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "profile.title": "Profile",
    "profile.loading": "Loading…",

    "profile.email.title": "Email address",
    "profile.email.current": "Current email",
    "profile.email.new": "New email",
    "profile.email.currentPassword": "Current password",
    "profile.email.submit": "Change email",
    "profile.email.success": "Email changed. Please confirm your new address.",

    "profile.password.title": "Password",
    "profile.password.old": "Current password",
    "profile.password.new": "New password",
    "profile.password.confirm": "Confirm new password",
    "profile.password.submit": "Change password",
    "profile.password.success": "Password changed.",
    "profile.password.mismatch": "Passwords do not match.",

    "profile.danger.title": "Delete account",
    "profile.danger.explainer":
      "Your account will be permanently deleted after a grace period. Until then you can cancel the deletion at any time.",
    "profile.danger.delete": "Delete account",
    "profile.danger.dialogTitle": "Really delete your account?",
    "profile.danger.dialogDescription":
      "After the grace period your data will be permanently deleted. Until then you can cancel.",
    "profile.danger.requested":
      "Deletion requested — your account will be permanently deleted on {date}.",
    "profile.danger.cancelDeletion": "Cancel deletion",
    "profile.danger.cancelSuccess": "Deletion cancelled. Your account stays.",

    "profile.errors.generic": "Something went wrong.",
    "profile.errors.emailUnchanged": "That is already your email address.",
    "user.errors.emailAlreadyExists": "This email address is already in use.",
    "auth.errors.invalidCredentials": "Email or password incorrect.",
  },
};
