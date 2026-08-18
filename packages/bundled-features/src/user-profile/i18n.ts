// @runtime client
// Default-Bundles für den ProfileScreen. Werden vom userProfileClient()
// als Fallback-Bundle in den LocaleProvider gehängt — Apps überschreiben
// einzelne Keys via `userProfileClient({ translations: { de: { … } } })`.
// `auth.errors.invalidCredentials` + `user.errors.emailAlreadyExists`
// sind hier gedoppelt, damit der Screen auch ohne die jeweiligen
// Feature-Bundles vollständig übersetzt.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "profile.title": "Profil",

    "profile.email.title": "E-Mail-Adresse",
    "profile.email.current": "Aktuelle E-Mail",
    "profile.email.new": "Neue E-Mail",
    "profile.email.currentPassword": "Aktuelles Passwort",
    "profile.email.submit": "E-Mail ändern",
    "profile.email.success": "E-Mail geändert. Bitte bestätige deine neue Adresse.",

    "profile.password.title": "Passwort",
    "profile.password.old": "Aktuelles Passwort",
    "profile.password.new": "Neues Passwort",
    "profile.password.confirm": "Neues Passwort bestätigen",
    "profile.password.submit": "Passwort ändern",
    "profile.password.success": "Passwort geändert.",
    "profile.password.mismatch": "Die Passwörter stimmen nicht überein.",

    "profile.danger.title": "Konto löschen",
    "profile.danger.explainer":
      "Dein Konto wird nach einer Frist endgültig gelöscht. Bis dahin kannst du die Löschung jederzeit abbrechen.",
    "profile.danger.delete": "Konto löschen",
    "profile.danger.dialogTitle": "Konto wirklich löschen?",
    "profile.danger.dialogDescription":
      "Nach Ablauf der Frist werden deine Daten endgültig gelöscht. Bis dahin kannst du die Löschung abbrechen.",
    "profile.danger.requested":
      "Löschung beantragt — dein Konto wird am {date} endgültig gelöscht.",
    "profile.danger.cancelDeletion": "Löschung abbrechen",
    "profile.danger.cancelSuccess": "Löschung abgebrochen. Dein Konto bleibt bestehen.",

    "profile.errors.generic": "Etwas ist schiefgegangen.",
    "profile.errors.emailUnchanged": "Das ist bereits deine E-Mail-Adresse.",
    "user.errors.emailAlreadyExists": "Diese E-Mail-Adresse wird bereits verwendet.",
    "auth.errors.invalidCredentials": "E-Mail oder Passwort falsch.",
  },
  en: {
    "profile.title": "Profile",

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
  es: {
    "profile.title": "Perfil",

    "profile.email.title": "Dirección de correo",
    "profile.email.current": "Correo actual",
    "profile.email.new": "Correo nuevo",
    "profile.email.currentPassword": "Contraseña actual",
    "profile.email.submit": "Cambiar correo",
    "profile.email.success": "Correo cambiado. Confirma tu nueva dirección.",

    "profile.password.title": "Contraseña",
    "profile.password.old": "Contraseña actual",
    "profile.password.new": "Contraseña nueva",
    "profile.password.confirm": "Confirmar contraseña nueva",
    "profile.password.submit": "Cambiar contraseña",
    "profile.password.success": "Contraseña cambiada.",
    "profile.password.mismatch": "Las contraseñas no coinciden.",

    "profile.danger.title": "Eliminar cuenta",
    "profile.danger.explainer":
      "Tu cuenta se eliminará definitivamente tras un plazo de gracia. Hasta entonces puedes cancelar la eliminación en cualquier momento.",
    "profile.danger.delete": "Eliminar cuenta",
    "profile.danger.dialogTitle": "¿Eliminar tu cuenta de verdad?",
    "profile.danger.dialogDescription":
      "Cuando termine el plazo, tus datos se eliminarán definitivamente. Hasta entonces puedes cancelarlo.",
    "profile.danger.requested":
      "Eliminación solicitada — tu cuenta se eliminará definitivamente el {date}.",
    "profile.danger.cancelDeletion": "Cancelar eliminación",
    "profile.danger.cancelSuccess": "Eliminación cancelada. Tu cuenta se mantiene.",

    "profile.errors.generic": "Algo ha salido mal.",
    "profile.errors.emailUnchanged": "Ese ya es tu correo actual.",
    "user.errors.emailAlreadyExists": "Esta dirección de correo ya está en uso.",
    "auth.errors.invalidCredentials": "Correo o contraseña incorrectos.",
  },
};
