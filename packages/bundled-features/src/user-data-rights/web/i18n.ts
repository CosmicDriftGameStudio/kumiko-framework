// @runtime client
// Default-Bundle für die Apex-Deletion-Screens. Apps hängen es als
// Fallback-Bundle in den LocaleProvider (createPublicSurface clientFeatures
// oder direkt) und können einzelne Keys überschreiben. Keys: `userDataRights.
// deletion.<step>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "userDataRights.deletion.request.title": "Account-Löschung beantragen",
    "userDataRights.deletion.request.intro":
      "Gib die E-Mail-Adresse deines Kontos ein. Falls ein Konto existiert, schicken wir dir einen Bestätigungs-Link zum Löschen.",
    "userDataRights.deletion.request.email": "E-Mail",
    "userDataRights.deletion.request.submit": "Bestätigungs-Link anfordern",
    "userDataRights.deletion.request.submitting": "…",
    "userDataRights.deletion.request.successTitle": "Mail gesendet",
    "userDataRights.deletion.request.successBody":
      "Falls die E-Mail in unserem System existiert, ist eine Nachricht mit einem Bestätigungs-Link unterwegs. Bitte schau in deinen Posteingang.",
    "userDataRights.deletion.request.error": "Etwas ist schief gegangen. Bitte erneut versuchen.",
    "userDataRights.deletion.confirm.title": "Account-Löschung bestätigen",
    "userDataRights.deletion.confirm.intro":
      "Mit dem Bestätigen startet die Lösch-Frist. Bis sie abläuft kannst du die Löschung im eingeloggten Account wieder abbrechen.",
    "userDataRights.deletion.confirm.submit": "Löschung bestätigen",
    "userDataRights.deletion.confirm.submitting": "…",
    "userDataRights.deletion.confirm.successTitle": "Löschung vorgemerkt",
    "userDataRights.deletion.confirm.successBody":
      "Dein Account wird nach Ablauf der Frist gelöscht. Du kannst die Löschung bis dahin im eingeloggten Account abbrechen.",
    "userDataRights.deletion.confirm.invalidToken":
      "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.",
    "userDataRights.deletion.confirm.missingToken":
      "Kein Token im Link gefunden. Bitte öffne den Link aus der E-Mail erneut.",
    "userDataRights.deletion.confirm.error": "Etwas ist schief gegangen. Bitte erneut versuchen.",
  },
  en: {
    "userDataRights.deletion.request.title": "Request account deletion",
    "userDataRights.deletion.request.intro":
      "Enter the email address of your account. If an account exists, we'll send you a confirmation link to delete it.",
    "userDataRights.deletion.request.email": "Email",
    "userDataRights.deletion.request.submit": "Request confirmation link",
    "userDataRights.deletion.request.submitting": "…",
    "userDataRights.deletion.request.successTitle": "Email sent",
    "userDataRights.deletion.request.successBody":
      "If the email exists in our system, a message with a confirmation link is on its way. Please check your inbox.",
    "userDataRights.deletion.request.error": "Something went wrong. Please try again.",
    "userDataRights.deletion.confirm.title": "Confirm account deletion",
    "userDataRights.deletion.confirm.intro":
      "Confirming starts the deletion grace period. Until it ends you can cancel the deletion from your logged-in account.",
    "userDataRights.deletion.confirm.submit": "Confirm deletion",
    "userDataRights.deletion.confirm.submitting": "…",
    "userDataRights.deletion.confirm.successTitle": "Deletion scheduled",
    "userDataRights.deletion.confirm.successBody":
      "Your account will be deleted after the grace period. You can cancel the deletion from your logged-in account until then.",
    "userDataRights.deletion.confirm.invalidToken":
      "The link is invalid or expired. Please request a new one.",
    "userDataRights.deletion.confirm.missingToken":
      "No token found in the link. Please open the link from the email again.",
    "userDataRights.deletion.confirm.error": "Something went wrong. Please try again.",
  },
};
