// @runtime client
// Default-Bundle für die Apex-Deletion-Screens. Apps hängen es als
// Fallback-Bundle in den LocaleProvider (createPublicSurface clientFeatures
// oder direkt) und können einzelne Keys überschreiben. Keys: `userDataRights.
// deletion.<step>.<slug>`.

import {
  mergeTranslations,
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { USER_DATA_RIGHTS_I18N } from "../i18n";

const apexTranslations: TranslationsByLocale = {
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

    "userDataRights.errors.download.notFound":
      "The download link is invalid or belongs to a different account.",
    "userDataRights.errors.download.expired":
      "Your download has expired. Please request a new export.",
    "userDataRights.errors.download.unavailable":
      "The export is not yet ready or has failed. Please check the status endpoint.",
    "userDataRights.errors.download.signedUrlNotSupported":
      "The download is currently unavailable due to a server configuration issue. The operator has been notified.",
  },
};

export const defaultTranslations: TranslationsByLocale = mergeTranslations(
  translationsByLocaleFromKeys(USER_DATA_RIGHTS_I18N),
  apexTranslations,
);
