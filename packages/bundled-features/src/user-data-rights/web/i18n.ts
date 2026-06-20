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

    "userDataRights.privacyCenter.title": "Datenschutz",
    "userDataRights.privacyCenter.intro":
      "Verwalte deine Rechte nach DSGVO: Datenauskunft, Export, Einschränkung und Löschung deines Kontos.",
    "userDataRights.privacyCenter.loading": "Lädt …",
    "userDataRights.privacyCenter.loadError": "Deine Daten konnten nicht geladen werden.",
    "userDataRights.privacyCenter.errors.generic":
      "Etwas ist schief gegangen. Bitte erneut versuchen.",

    "userDataRights.privacyCenter.export.title": "Daten exportieren (Art. 20)",
    "userDataRights.privacyCenter.export.intro":
      "Fordere eine Kopie deiner Daten an. Die Erstellung läuft im Hintergrund; sobald sie fertig ist, kannst du sie hier herunterladen.",
    "userDataRights.privacyCenter.export.request": "Daten-Export anfordern",
    "userDataRights.privacyCenter.export.requesting": "Wird angefordert …",
    "userDataRights.privacyCenter.export.pending":
      "Dein Export wird erstellt. Bitte später erneut schauen.",
    "userDataRights.privacyCenter.export.failed":
      "Die letzte Export-Erstellung ist fehlgeschlagen. Du kannst es erneut versuchen.",
    "userDataRights.privacyCenter.export.ready": "Dein Export ist fertig.",
    "userDataRights.privacyCenter.export.download": "Export herunterladen",
    "userDataRights.privacyCenter.export.availableUntil": "Verfügbar bis {date}",
    "userDataRights.privacyCenter.export.requestNew": "Neuen Export anfordern",

    "userDataRights.privacyCenter.restriction.title": "Verarbeitung einschränken (Art. 18)",
    "userDataRights.privacyCenter.restriction.explainer":
      "Friere dein Konto ein: Die Verarbeitung deiner Daten wird pausiert und du wirst abgemeldet. Das Aufheben der Einschränkung ist danach nur über den Support möglich.",
    "userDataRights.privacyCenter.restriction.restrict": "Konto einschränken",
    "userDataRights.privacyCenter.restriction.dialogTitle": "Konto wirklich einschränken?",
    "userDataRights.privacyCenter.restriction.dialogDescription":
      "Du wirst sofort abgemeldet und kannst dich nicht mehr anmelden, bis der Support die Einschränkung aufhebt.",
    "userDataRights.privacyCenter.restriction.restricted":
      "Dein Konto ist eingeschränkt. Wende dich an den Support, um die Einschränkung aufzuheben.",

    "userDataRights.privacyCenter.deletion.title": "Konto löschen (Art. 17)",
    "userDataRights.privacyCenter.deletion.explainer":
      "Beantrage die Löschung deines Kontos. Bis zum Ablauf der Frist kannst du die Löschung wieder abbrechen.",
    "userDataRights.privacyCenter.deletion.delete": "Konto löschen",
    "userDataRights.privacyCenter.deletion.requested": "Dein Konto wird am {date} gelöscht.",
    "userDataRights.privacyCenter.deletion.cancel": "Löschung abbrechen",
    "userDataRights.privacyCenter.deletion.cancelSuccess": "Die Löschung wurde abgebrochen.",
    "userDataRights.privacyCenter.deletion.dialogTitle": "Konto wirklich löschen?",
    "userDataRights.privacyCenter.deletion.dialogDescription":
      "Mit dem Bestätigen startet die Lösch-Frist. Du kannst die Löschung bis zu ihrem Ablauf wieder abbrechen.",

    "userDataRights.privacyCenter.audit.title": "Aktivitätsprotokoll (Art. 15)",
    "userDataRights.privacyCenter.audit.intro":
      "Die letzten Ereignisse zu deinem Konto über alle Tenants hinweg.",
    "userDataRights.privacyCenter.audit.empty": "Noch keine Ereignisse.",
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

    "userDataRights.privacyCenter.title": "Privacy",
    "userDataRights.privacyCenter.intro":
      "Manage your GDPR rights: access, export, restrict, and delete your account.",
    "userDataRights.privacyCenter.loading": "Loading …",
    "userDataRights.privacyCenter.loadError": "Your data could not be loaded.",
    "userDataRights.privacyCenter.errors.generic": "Something went wrong. Please try again.",

    "userDataRights.privacyCenter.export.title": "Export your data (Art. 20)",
    "userDataRights.privacyCenter.export.intro":
      "Request a copy of your data. It is prepared in the background; once ready you can download it here.",
    "userDataRights.privacyCenter.export.request": "Request data export",
    "userDataRights.privacyCenter.export.requesting": "Requesting …",
    "userDataRights.privacyCenter.export.pending":
      "Your export is being prepared. Please check back later.",
    "userDataRights.privacyCenter.export.failed":
      "The last export failed to build. You can try again.",
    "userDataRights.privacyCenter.export.ready": "Your export is ready.",
    "userDataRights.privacyCenter.export.download": "Download export",
    "userDataRights.privacyCenter.export.availableUntil": "Available until {date}",
    "userDataRights.privacyCenter.export.requestNew": "Request a new export",

    "userDataRights.privacyCenter.restriction.title": "Restrict processing (Art. 18)",
    "userDataRights.privacyCenter.restriction.explainer":
      "Freeze your account: processing of your data is paused and you are signed out. Lifting the restriction afterwards is only possible via support.",
    "userDataRights.privacyCenter.restriction.restrict": "Restrict account",
    "userDataRights.privacyCenter.restriction.dialogTitle": "Restrict your account?",
    "userDataRights.privacyCenter.restriction.dialogDescription":
      "You will be signed out immediately and cannot sign in again until support lifts the restriction.",
    "userDataRights.privacyCenter.restriction.restricted":
      "Your account is restricted. Contact support to lift the restriction.",

    "userDataRights.privacyCenter.deletion.title": "Delete account (Art. 17)",
    "userDataRights.privacyCenter.deletion.explainer":
      "Request deletion of your account. Until the grace period ends you can cancel the deletion.",
    "userDataRights.privacyCenter.deletion.delete": "Delete account",
    "userDataRights.privacyCenter.deletion.requested": "Your account will be deleted on {date}.",
    "userDataRights.privacyCenter.deletion.cancel": "Cancel deletion",
    "userDataRights.privacyCenter.deletion.cancelSuccess": "The deletion was cancelled.",
    "userDataRights.privacyCenter.deletion.dialogTitle": "Delete your account?",
    "userDataRights.privacyCenter.deletion.dialogDescription":
      "Confirming starts the deletion grace period. You can cancel the deletion until it ends.",

    "userDataRights.privacyCenter.audit.title": "Activity log (Art. 15)",
    "userDataRights.privacyCenter.audit.intro":
      "The most recent events on your account across all tenants.",
    "userDataRights.privacyCenter.audit.empty": "No events yet.",
  },
};
