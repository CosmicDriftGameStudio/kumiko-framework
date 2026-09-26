// @runtime client
import { localeDeBundle } from "./strings";

export type GermanAddress = "informal" | "formal";

export const localeDeFormalOverrides: Readonly<Record<string, string>> = {
  "auth.errors.accountRestricted":
    "Konto nach Art. 18 DSGVO eingeschränkt. Heben Sie die Einschränkung auf, um sich wieder anzumelden.",
  "auth.errors.invalidResetToken":
    "Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.",
  "auth.errors.invalidSignupToken":
    "Der Aktivierungs-Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.",
  "auth.errors.invalidUnlockToken":
    "Der Entsperren-Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.",
  "auth.errors.signupEmailAlreadyRegistered":
    "Für diese E-Mail-Adresse existiert bereits ein Konto. Bitte loggen Sie sich ein oder setzen Sie Ihr Passwort zurück.",
  "auth.forgotPassword.intro":
    "Geben Sie Ihre E-Mail-Adresse ein. Falls ein Konto existiert, schicken wir Ihnen einen Reset-Link.",
  "auth.forgotPassword.successBody":
    "Falls die E-Mail in unserem System existiert, ist eine Nachricht mit einem Reset-Link unterwegs. Bitte schauen Sie in Ihren Posteingang.",
  "auth.inviteAccept.intro":
    "Sie wurden zu einem Workspace eingeladen. Klicken Sie auf „Annehmen“, um Mitglied zu werden.",
  "auth.inviteAccept.loggedInAs":
    "Sie sind als {email} angemeldet. Klicken Sie auf „Annehmen“, um Mitglied zu werden.",
  "auth.login.resendRateLimited": "Bitte warten Sie kurz und versuchen Sie es erneut.",
  "auth.login.resendSuccess": "Wir haben Ihnen eine neue Bestätigungs-Mail geschickt.",
  "auth.mail.activation.ignore":
    "Falls Sie sich nicht registriert haben, können Sie diese E-Mail ignorieren. Es wird kein Account erstellt, solange Sie den Link nicht öffnen.",
  "auth.mail.activation.intro":
    "klicken Sie auf den folgenden Link, um Ihren {app}-Account zu aktivieren. Im nächsten Schritt setzen Sie Ihr Passwort:",
  "auth.mail.invite.ignore":
    "Falls Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.",
  "auth.mail.invite.intro":
    "Sie wurden zu einem {app}-Workspace als {role} eingeladen. Klicken Sie auf den folgenden Link, um die Einladung anzunehmen:",
  "auth.mail.reset.ignore":
    "Falls Sie keinen Reset angefordert haben, können Sie diese E-Mail einfach ignorieren. Ihr Passwort bleibt unverändert.",
  "auth.mail.reset.intro":
    "Sie haben den Reset Ihres Passworts für {app} angefordert. Klicken Sie auf den folgenden Link, um ein neues Passwort zu setzen:",
  "auth.mail.unlock.ignore":
    "Falls Sie diese Sperre nicht ausgelöst haben, können Sie diese E-Mail ignorieren. Die Sperre läuft von selbst wieder ab.",
  "auth.mail.unlock.intro":
    "Ihr {app}-Konto wurde nach mehreren fehlgeschlagenen Anmeldeversuchen vorübergehend gesperrt. Klicken Sie auf den folgenden Link, um es sofort zu entsperren:",
  "auth.mail.verify.ignore":
    "Falls Sie dieses Konto nicht angelegt haben, können Sie diese E-Mail ignorieren.",
  "auth.mail.verify.intro":
    "bitte bestätigen Sie Ihre E-Mail-Adresse für {app}, um Ihr Konto zu aktivieren:",
  "auth.mfa.disable.description":
    "Bestätigen Sie mit einem Code aus Ihrer Authenticator-App oder einem Recovery-Code. Ihr Konto ist danach nur noch durch Ihr Passwort geschützt.",
  "auth.mfa.enable.intro":
    "Schützen Sie Ihr Konto zusätzlich mit einer Authenticator-App wie Google Authenticator oder 1Password.",
  "auth.mfa.enable.recoveryHint":
    "Speichern Sie diese Codes an einem sicheren Ort. Sie werden nur dieses eine Mal angezeigt und erlauben Ihnen den Zugriff, falls Sie Ihr Gerät verlieren.",
  "auth.mfa.regenerate.description":
    "Bestätigen Sie mit einem Code aus Ihrer Authenticator-App. Alle bisherigen Recovery-Codes werden sofort ungültig.",
  "auth.mfa.regenerate.newCodesHint":
    "Speichern Sie diese Codes an einem sicheren Ort. Die alten Codes funktionieren ab sofort nicht mehr.",
  "auth.mfa.regenerate.newCodesTitle": "Ihre neuen Recovery-Codes",
  "auth.mfa.setup.subtitle":
    "Ihr Konto verlangt Zwei-Faktor-Authentifizierung. Richten Sie sie jetzt ein, um sich anzumelden.",
  "auth.mfa.verify.subtitle": "Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.",
  "auth.requestUnlock.intro":
    "Geben Sie Ihre E-Mail-Adresse ein. Falls Ihr Konto gesperrt ist, schicken wir Ihnen einen Entsperren-Link.",
  "auth.requestUnlock.successBody":
    "Falls die E-Mail in unserem System existiert und gesperrt ist, ist eine Nachricht mit einem Entsperren-Link unterwegs. Bitte schauen Sie in Ihren Posteingang.",
  "auth.resetPassword.intro": "Wählen Sie ein neues Passwort mit mindestens 8 Zeichen.",
  "auth.resetPassword.missingToken":
    "Der Reset-Link enthält keinen Token. Bitte fordern Sie einen neuen an.",
  "auth.resetPassword.successBody": "Sie können sich jetzt mit Ihrem neuen Passwort anmelden.",
  "auth.signup.intro":
    "Geben Sie Ihre E-Mail-Adresse ein. Wir schicken Ihnen einen Aktivierungs-Link, mit dem Sie Ihr Passwort setzen.",
  "auth.signup.successBody":
    "Wir haben Ihnen einen Aktivierungs-Link an Ihre E-Mail-Adresse geschickt. Klicken Sie ihn an, um Ihr Passwort zu setzen und sich einzuloggen.",
  "auth.signupComplete.activated": "Ihr Konto ist jetzt aktiv und Sie sind angemeldet.",
  "auth.signupComplete.intro":
    "Wählen Sie ein Passwort mit mindestens 8 Zeichen für Ihren neuen Account.",
  "auth.signupComplete.missingToken":
    "Der Aktivierungs-Link enthält keinen Token. Bitte fordern Sie einen neuen an.",
  "auth.unlockAccount.errorBody":
    "Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen Entsperren-Link an.",
  "auth.unlockAccount.successBody":
    "Ihr Konto ist wieder entsperrt. Sie können sich jetzt anmelden.",
  "auth.verifyEmail.errorBody":
    "Der Link ist ungültig oder abgelaufen. Bitte fordern Sie eine neue Bestätigungs-Mail an.",
  "auth.verifyEmail.successBody": "Danke! Sie können sich jetzt anmelden.",
  "billing-foundation.plans.billingDisabled":
    "Die Abrechnung ist noch nicht aktiv. Ihr aktueller Tarif bleibt bestehen.",
  "billing-foundation.plans.subscriptionPending": "Ihr Tarifwechsel wird gerade verarbeitet.",
  "custom-fields.form.createMode": "Speichern Sie zuerst den Eintrag, um Custom-Felder zu setzen.",
  "dispatcher.errors.network":
    "Netzwerkfehler. Bitte überprüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
  "errors.access.denied": "Dazu haben Sie keine Berechtigung.",
  "errors.download.urlMissing": "Download nicht verfügbar. Bitte versuchen Sie es erneut.",
  "errors.internal": "Etwas ist schiefgegangen. Bitte versuchen Sie es später erneut.",
  "errors.rate_limited": "Zu viele Anfragen. Bitte versuchen Sie es in Kürze erneut.",
  "folders.section.createMode": "Speichern Sie zuerst den Eintrag, um einen Ordner zu wählen.",
  "gdpr.mail.deletionExecuted.intro":
    "Ihr {app}-Konto und die zugehoerigen personenbezogenen Daten wurden am {when} geloescht. Diese Aktion ist endgueltig.",
  "gdpr.mail.deletionExecuted.subject": "{app} — Ihr Konto wurde geloescht",
  "gdpr.mail.deletionRequested.cancel":
    "Falls Sie das nicht angefordert haben, melden Sie sich an und brechen Sie die Loeschung in den Kontoeinstellungen ab, bevor die Frist ablaeuft.",
  "gdpr.mail.deletionRequested.intro":
    "wir haben Ihren Antrag zur Loeschung Ihres {app}-Kontos erhalten. Ihr Konto und die zugehoerigen Daten werden am {when} endgueltig geloescht.",
  "gdpr.mail.deletionRequested.subject": "{app} — Loeschung Ihres Kontos angefordert",
  "gdpr.mail.exportFailed.intro":
    "Ihr angeforderter Datenexport fuer {app} konnte leider nicht erstellt werden. Bitte fordern Sie den Export erneut an.",
  "gdpr.mail.exportFailed.subject": "{app} — Ihr Datenexport ist fehlgeschlagen",
  "gdpr.mail.exportReady.intro":
    "Ihr angeforderter Datenexport fuer {app} ist fertig. Laden Sie ihn ueber den folgenden Link herunter:",
  "gdpr.mail.exportReady.subject": "{app} — Ihr Datenexport ist bereit",
  "kumiko.field.reference-created-no-id":
    "Der Eintrag wurde angelegt, aber nicht automatisch ausgewählt. Bitte wählen Sie ihn manuell aus.",
  "kumiko.form.draft.resume-multiple":
    "Mehrere offene Entwürfe für dieses Formular gefunden. Welchen möchten Sie fortsetzen?",
  "kumiko.form.draft.resume-single":
    "Ein offener Entwurf für dieses Formular gefunden. Möchten Sie ihn fortsetzen?",
  "notesHistory.section.createMode": "Speichern Sie zuerst den Eintrag, um Notizen anzulegen.",
  "pat.create.needPassword": "Bitte Ihr Passwort zur Bestätigung eingeben.",
  "pat.create.subtitle":
    "Wählen Sie Berechtigungen und eine Gültigkeit. Der Token wird nur einmal angezeigt.",
  "pat.list.title": "Ihre Tokens",
  "screen:my-sessions.title": "Ihre Sitzungen",
  "profile.danger.cancelSuccess": "Löschung abgebrochen. Ihr Konto bleibt bestehen.",
  "profile.danger.dialogDescription":
    "Nach Ablauf der Frist werden Ihre Daten endgültig gelöscht. Bis dahin können Sie die Löschung abbrechen.",
  "profile.danger.explainer":
    "Ihr Konto wird nach einer Frist endgültig gelöscht. Bis dahin können Sie die Löschung jederzeit abbrechen.",
  "profile.danger.requested": "Löschung beantragt. Ihr Konto wird am {date} endgültig gelöscht.",
  "profile.email.success": "E-Mail geändert. Bitte bestätigen Sie Ihre neue Adresse.",
  "profile.errors.emailUnchanged": "Das ist bereits Ihre E-Mail-Adresse.",
  "tags.section.createMode": "Speichern Sie zuerst den Eintrag, um Tags zu setzen.",
  "userDataRights.deletion.confirm.intro":
    "Mit dem Bestätigen startet die Lösch-Frist. Bis sie abläuft können Sie die Löschung im eingeloggten Account wieder abbrechen.",
  "userDataRights.deletion.confirm.invalidToken":
    "Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.",
  "userDataRights.deletion.confirm.missingToken":
    "Kein Token im Link gefunden. Bitte öffnen Sie den Link aus der E-Mail erneut.",
  "userDataRights.deletion.confirm.successBody":
    "Ihr Account wird nach Ablauf der Frist gelöscht. Sie können die Löschung bis dahin im eingeloggten Account abbrechen.",
  "userDataRights.deletion.request.intro":
    "Geben Sie die E-Mail-Adresse Ihres Kontos ein. Falls ein Konto existiert, schicken wir Ihnen einen Bestätigungs-Link zum Löschen.",
  "userDataRights.deletion.request.successBody":
    "Falls die E-Mail in unserem System existiert, ist eine Nachricht mit einem Bestätigungs-Link unterwegs. Bitte schauen Sie in Ihren Posteingang.",
  "userDataRights.errors.download.expired":
    "Ihr Download ist abgelaufen. Bitte fordern Sie einen neuen Export an.",
  "userDataRights.errors.download.signedUrlNotSupported":
    "Der Download ist derzeit nicht möglich. Wir wurden bereits informiert, bitte versuchen Sie es später erneut.",
  "userDataRights.errors.download.unavailable":
    "Der Export ist noch nicht fertig oder fehlgeschlagen. Bitte prüfen Sie den Status.",
  "userDataRights.privacyCenter.deletion.dialogDescription":
    "Mit dem Bestätigen startet die Lösch-Frist. Sie können die Löschung bis zu ihrem Ablauf wieder abbrechen.",
  "userDataRights.privacyCenter.deletion.explainer":
    "Beantragen Sie die Löschung Ihres Kontos. Bis zum Ablauf der Frist können Sie die Löschung wieder abbrechen.",
  "userDataRights.privacyCenter.deletion.requested": "Ihr Konto wird am {date} gelöscht.",
  "userDataRights.privacyCenter.export.failed":
    "Die letzte Export-Erstellung ist fehlgeschlagen. Sie können es erneut versuchen.",
  "userDataRights.privacyCenter.export.intro":
    "Fordern Sie eine Kopie Ihrer Daten an. Die Erstellung läuft im Hintergrund; sobald sie fertig ist, können Sie sie hier herunterladen.",
  "userDataRights.privacyCenter.export.pending":
    "Ihr Export wird erstellt. Bitte später erneut schauen.",
  "userDataRights.privacyCenter.export.ready": "Ihr Export ist fertig.",
  "userDataRights.privacyCenter.intro":
    "Verwalten Sie Ihre Rechte nach DSGVO: Datenauskunft, Export, Einschränkung und Löschung Ihres Kontos.",
  "userDataRights.privacyCenter.loadError": "Ihre Daten konnten nicht geladen werden.",
  "userDataRights.privacyCenter.restriction.dialogDescription":
    "Sie werden sofort abgemeldet und können sich nicht mehr anmelden, bis der Support die Einschränkung aufhebt.",
  "userDataRights.privacyCenter.restriction.explainer":
    "Die Verarbeitung Ihrer Daten wird pausiert, und Sie werden sofort abgemeldet. Nur der Support kann die Einschränkung danach wieder aufheben.",
  "userDataRights.privacyCenter.restriction.restricted":
    "Ihr Konto ist eingeschränkt. Wenden Sie sich an den Support, um die Einschränkung aufzuheben.",
  "pat.created.hint":
    "Kopieren Sie diesen Token jetzt. Aus Sicherheitsgründen wird er nur dieses eine Mal angezeigt.",
  "kumiko.list.empty.hint": "Legen Sie den ersten an, um loszulegen.",
  "auth.mfa.setup.intro":
    "Scannen Sie den QR-Code mit einer Authenticator-App wie Google Authenticator oder 1Password.",
  "tier-admin.explainer":
    "Weisen Sie einem Mandanten ein Tier ohne Kauf zu. Die manuelle Zuweisung bleibt bestehen, auch wenn sich die Abrechnung später automatisch aktualisiert.",
};

export function germanBundleFor(address: GermanAddress): Readonly<Record<string, string>> {
  if (address === "informal") return localeDeBundle;
  return { ...localeDeBundle, ...localeDeFormalOverrides };
}
