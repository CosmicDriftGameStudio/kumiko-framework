// @runtime client
//
// Default-Translations fuer user-data-rights Error-Wire-Keys (S2.U3 Atom 4b.fix3).
//
// Wire-Errors aus den download-handlers tragen i18nKeys statt fixe
// Strings — UI rendert die Keys ueber den Renderer-LocaleProvider. Apps
// koennen einzelne Keys via `userDataRightsClient({ translations: { de:
// {...} } })` ueberschreiben (Pattern matched auth-email-password).
//
// **Scope 4b.fix3:** nur die download-error-keys. Andere Keys (UI-
// Texte fuer Forget-Pfad, Status-Labels, Banner) kommen mit Atom 6+
// (UI-Integration).

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "userDataRights.errors.download.notFound":
      "Der Download-Link ist ungültig oder gehört zu einem anderen Konto.",
    "userDataRights.errors.download.expired":
      "Dein Download ist abgelaufen. Bitte fordere einen neuen Export an.",
    "userDataRights.errors.download.unavailable":
      "Der Export ist noch nicht fertig oder fehlgeschlagen. Bitte schau im Status-Polling nach.",
    "userDataRights.errors.download.signedUrlNotSupported":
      "Der Download steht aufgrund einer Server-Konfiguration aktuell nicht zur Verfügung. Der Operator wurde benachrichtigt.",
  },
  en: {
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
