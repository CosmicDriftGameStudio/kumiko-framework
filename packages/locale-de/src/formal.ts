// @runtime client
import { localeDeBundle } from "./strings";

export type GermanAddress = "informal" | "formal";

export const localeDeFormalOverrides: Readonly<Record<string, string>> = {
  "documentDesigner.editor.mjmlNotice.tenant":
    "Sie sehen das System-Layout. Speichern legt ein eigenes Layout für Ihren Mandanten an.",
  "documentDesigner.editor.origin.system":
    "Sie sehen das System-Layout. Speichern legt eine Anpassung für Ihren Mandanten an.",
  "documentDesigner.editor.diff.identical": "Ihr Layout entspricht dem System-Layout.",
  "documentDesigner.mail.testMail.unavailable.noAddress":
    "Für Sie ist keine E-Mail-Adresse hinterlegt, daher kann keine Test-Mail gesendet werden.",
  "documentDesigner.editor.reset.description":
    "Ihr eigenes Layout wird entfernt, danach gilt wieder das System-Layout.",
  "documentDesigner.editor.dirtySwitch.description":
    "Beim Wechsel der Layout-Art gehen Ihre ungespeicherten Änderungen verloren.",
  "documentDesigner.origin.draftBesideActive":
    "Verschickt wird Version {active}, Ihr Entwurf (Version {draft}) ist noch nicht veröffentlicht.",
  "documentDesigner.mail.origin.tenantOnly": "Diese Vorlage gibt es nur für Ihren Mandanten.",
  "documentDesigner.mail.origin.system":
    "Sie sehen die System-Vorlage v{version}. Speichern legt eine Anpassung für Ihren Mandanten an.",
  "documentDesigner.mail.props.senderHintTenant":
    "Die Adresse kommt aus dem E-Mail-Versand Ihres Mandanten.",
  "documentDesigner.mail.origin.copyNote":
    "Beim Kopieren einer System-Fassung kommen Bilder und Anhänge nicht mit; laden Sie sie danach neu hoch.",
  "documentDesigner.mail.origin.creating":
    "Neue Fassung für {language}. Sie wird erst mit Speichern angelegt.",
  "documentDesigner.mail.reset.description":
    "Ihre Anpassung dieser Vorlage wird in allen Sprachen entfernt. Danach gilt wieder die System-Vorlage.",
  "documentDesigner.mail.discard.description": "Ihre ungespeicherten Änderungen gehen verloren.",
  "documentDesigner.mail.leave.description":
    "Speichern Sie Ihre Änderungen als Entwurf, verwerfen Sie sie oder bleiben Sie auf dieser Seite.",
  "documentDesigner.mail.testMail.ownAddress": "Ihre Adresse",
  "documentDesigner.mail.testMail.hint":
    "Versand über den normalen Zustellweg des Mandanten an Ihre eigene Adresse.",
  "documentDesigner.mail.testMail.sent": "Test-Mail an Ihre Adresse gesendet: {subject}",
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
  "auth.login.sessionEnded": "Ihre Sitzung wurde beendet. Bitte melden Sie sich erneut an.",
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
  "auth.mfa.enable.recoveryHint":
    "Speichern Sie diese Codes an einem sicheren Ort. Sie werden nur dieses eine Mal angezeigt und erlauben Ihnen den Zugriff, falls Sie Ihr Gerät verlieren.",
  "auth.mfa.regenerate.description":
    "Bestätigen Sie mit einem Code aus Ihrer Authenticator-App. Alle bisherigen Recovery-Codes werden sofort ungültig.",
  "auth.mfa.regenerate.newCodesHint":
    "Speichern Sie diese Codes an einem sicheren Ort. Die alten Codes funktionieren ab sofort nicht mehr.",
  "auth.mfa.regenerate.newCodesTitle": "Ihre neuen Recovery-Codes",
  "auth.mfa.setup.subtitle":
    "Ihr Konto verlangt Zwei-Faktor-Authentifizierung. Richten Sie sie jetzt ein, um sich anzumelden.",
  "auth.mfa.verify.recoverySubtitle":
    "Geben Sie einen der Recovery-Codes ein, die Sie beim Einrichten gespeichert haben.",
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
  "auth.signupComplete.activatedMfaPending":
    "Ihr Konto ist aktiv. Melden Sie sich an, um die Zwei-Faktor-Authentifizierung einzurichten.",
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
  "billing-foundation.cancel.confirmQuestion":
    "Möchten Sie diese Erklärung jetzt abgeben? Erklärung: {declaration}, Art: {kind}.",
  "billing-foundation.cancel.effectiveUnknown":
    "Den Wirksamkeitszeitpunkt bestätigen wir Ihnen per E-Mail.",
  "billing-foundation.cancel.emailConfirmation": "Sie erhalten eine Bestätigung per E-Mail.",
  "billing-foundation.cancel.receivedAt": "Ihre Erklärung ist am {date} bei uns eingegangen.",
  "billing-foundation.consent.cancelAnytime":
    "Sie können jederzeit zum Ende des laufenden Zeitraums kündigen.",
  "billing-foundation.consent.renews.day": "Verlängert sich täglich, bis Sie kündigen.",
  "billing-foundation.consent.renews.month": "Verlängert sich monatlich, bis Sie kündigen.",
  "billing-foundation.consent.renews.week": "Verlängert sich wöchentlich, bis Sie kündigen.",
  "billing-foundation.consent.renews.year": "Verlängert sich jährlich, bis Sie kündigen.",
  "billing-foundation.consent.renewsEvery.day":
    "Verlängert sich alle {count} Tage, bis Sie kündigen.",
  "billing-foundation.consent.renewsEvery.month":
    "Verlängert sich alle {count} Monate, bis Sie kündigen.",
  "billing-foundation.consent.renewsEvery.week":
    "Verlängert sich alle {count} Wochen, bis Sie kündigen.",
  "billing-foundation.consent.renewsEvery.year":
    "Verlängert sich alle {count} Jahre, bis Sie kündigen.",
  "billing-foundation.errors.consentRequired":
    "Bestätigen Sie beide Zustimmungen, bevor Sie fortfahren.",
  "billing-foundation.errors.consentTextOutdated":
    "Der Zustimmungstext hat sich geändert. Laden Sie die Seite neu und bestätigen Sie erneut.",
  "billing-foundation.errors.termsUnavailable":
    "Die AGB sind vorübergehend nicht verfügbar. Bitte versuchen Sie es später erneut.",
  "billing-foundation.plans.billingDisabled":
    "Die Abrechnung ist noch nicht aktiv. Ihr aktueller Tarif bleibt bestehen.",
  "billing-foundation.plans.cancelScheduled": "Ihr Abo endet am {date}.",
  "billing-foundation.plans.subscriptionPending": "Ihr Tarifwechsel wird gerade verarbeitet.",
  "custom-fields.form.createMode": "Speichern Sie zuerst den Eintrag, um Custom-Felder zu setzen.",
  "dispatcher.errors.network":
    "Netzwerkfehler. Bitte überprüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
  "errors.access.denied": "Dazu haben Sie keine Berechtigung.",
  "errors.demoReadOnly": "Diese Live-Demo ist schreibgeschützt.",
  "errors.download.urlMissing": "Download nicht verfügbar. Bitte versuchen Sie es erneut.",
  "errors.internal": "Etwas ist schiefgegangen. Bitte versuchen Sie es später erneut.",
  "errors.rate_limited": "Zu viele Anfragen. Bitte versuchen Sie es in Kürze erneut.",
  "errors.rate_limit_unavailable":
    "Die Anfragenbegrenzung ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in Kürze erneut.",
  "folders.section.createMode": "Speichern Sie zuerst den Eintrag, um einen Ordner zu wählen.",
  "gdpr.mail.deletionExecuted.intro":
    "Ihr {app}-Konto und die zugehörigen personenbezogenen Daten wurden am {when} gelöscht. Diese Aktion ist endgültig.",
  "gdpr.mail.deletionExecuted.subject": "{app} — Ihr Konto wurde gelöscht",
  "gdpr.mail.deletionRequested.cancel":
    "Falls Sie das nicht angefordert haben, melden Sie sich an und brechen Sie die Löschung in den Kontoeinstellungen ab, bevor die Frist abläuft.",
  "gdpr.mail.deletionRequested.intro":
    "wir haben Ihren Antrag zur Löschung Ihres {app}-Kontos erhalten. Ihr Konto und die zugehörigen Daten werden am {when} endgültig gelöscht.",
  "gdpr.mail.deletionRequested.subject": "{app} — Löschung Ihres Kontos angefordert",
  "gdpr.mail.exportFailed.intro":
    "Ihr angeforderter Datenexport für {app} konnte leider nicht erstellt werden. Bitte fordern Sie den Export erneut an.",
  "gdpr.mail.exportFailed.subject": "{app} — Ihr Datenexport ist fehlgeschlagen",
  "gdpr.mail.exportReady.intro":
    "Ihr angeforderter Datenexport für {app} ist fertig. Laden Sie ihn über den folgenden Link herunter:",
  "gdpr.mail.exportReady.subject": "{app} — Ihr Datenexport ist bereit",
  "inactivity.mail.warning.after":
    "Auch nach dem Löschantrag können Sie die Löschung bis zum Ende der Wartefrist in den Kontoeinstellungen abbrechen.",
  "inactivity.mail.warning.intro":
    "in Ihrem {app}-Konto {account} hat sich lange niemand angemeldet. Bleibt das so, beantragen wir am {when} die Löschung des Kontos mit allen Daten.",
  "inactivity.mail.warning.keep":
    "Wenn Sie das Konto behalten möchten, melden Sie sich an oder klicken Sie auf den Button. Dann beginnt die Frist neu.",
  "inactivity.mail.warning.subject": "{app}: Löschantrag für Ihr Konto {account} am {when}",
  "config.settings.audience.user": "Gilt nur für Sie.",
  "config.settings.extensionSelectorHint":
    "Wählen Sie einen Anbieter. Seine Einstellungen erscheinen darunter und werden mit ihm gespeichert.",
  "kumiko.config.cascade.origin.user": "Von Ihnen gesetzt. Standard ist {value}.",
  "kumiko.config.cascade.originNoDefault.user": "Von Ihnen gesetzt.",
  "kumiko.config.source.user": "Ihr Wert",
  "kumiko.drawer.discard.body": "Ihre Eingaben in diesem Formular gehen verloren.",
  "kumiko.field.reference-created-no-id":
    "Der Eintrag wurde angelegt, aber nicht automatisch ausgewählt. Bitte wählen Sie ihn manuell aus.",
  "kumiko.form.draft.resume-multiple":
    "Mehrere offene Entwürfe für dieses Formular gefunden. Welchen möchten Sie fortsetzen?",
  "kumiko.form.draft.resume-single":
    "Ein offener Entwurf für dieses Formular gefunden. Möchten Sie ihn fortsetzen?",
  "kumiko.form.unsavedChangesActionConfirm":
    "Ungespeicherte Änderungen in diesem Formular gehen verloren, wenn Sie fortfahren.",
  "notesHistory.section.createMode": "Speichern Sie zuerst den Eintrag, um Notizen anzulegen.",
  "rateLimiting.errors.bucketOutsideTenant":
    "Sie können nur Rate-Limit-Buckets Ihres eigenen Mandanten oder Benutzers einsehen.",
  "screen:my-sessions.title": "Ihre Sitzungen",
  "profile.danger.dialogDescription":
    "Nach Ablauf der Frist werden Ihre Daten endgültig gelöscht. Bis dahin können Sie die Löschung abbrechen.",
  "profile.danger.explainer":
    "Ihr Konto wird nach einer Frist endgültig gelöscht. Bis dahin können Sie die Löschung jederzeit abbrechen.",
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
  "userDataRights.privacyCenter.export.failed":
    "Die letzte Export-Erstellung ist fehlgeschlagen. Sie können es erneut versuchen.",
  "userDataRights.privacyCenter.export.intro":
    "Fordern Sie eine Kopie Ihrer Daten an. Die Erstellung läuft im Hintergrund; sobald sie fertig ist, können Sie sie hier herunterladen.",
  "userDataRights.privacyCenter.export.pending":
    "Ihr Export wird erstellt. Bitte später erneut schauen.",
  "userDataRights.privacyCenter.export.ready": "Ihr Export ist fertig.",
  "userDataRights.privacyCenter.restriction.dialogDescription":
    "Sie werden sofort abgemeldet und können sich nicht mehr anmelden, bis der Support die Einschränkung aufhebt.",
  "userDataRights.privacyCenter.restriction.explainer":
    "Die Verarbeitung Ihrer Daten wird pausiert, und Sie werden sofort abgemeldet. Nur der Support kann die Einschränkung danach wieder aufheben.",
  "pat.created.hint":
    "Kopieren Sie diesen Token jetzt. Aus Sicherheitsgründen wird er nur dieses eine Mal angezeigt.",
  "kumiko.list.empty.hint": "Legen Sie den ersten an, um loszulegen.",
  "kumiko.dashboard.record.missing":
    "Öffnen Sie diese Seite über einen Datensatz, um das Dashboard zu sehen.",
  "kumiko.screen-access-denied.title": "Sie haben keinen Zugriff auf diese Seite.",
  "kumiko.screen-missing.hint":
    "Sie ist für Ihr Konto nicht freigeschaltet oder existiert nicht mehr.",
  "auth.mfa.setup.intro":
    "Scannen Sie den QR-Code mit einer Authenticator-App wie Google Authenticator oder 1Password.",
  "mail-foundation.provider.description":
    "Legen Sie fest, über wen Ihre E-Mails verschickt werden. Der Plattform-Versand braucht keine eigenen Einstellungen.",
  "mail-transport-smtp.settings.description":
    "Die Zugangsdaten bekommen Sie von Ihrem Mail-Anbieter, zum Beispiel Brevo, Postmark, Amazon SES oder Ihrem eigenen Server.",
  "mail-transport-smtp.port.description":
    "Meist 587. Nehmen Sie 465, wenn Ihr Anbieter SSL/TLS verlangt.",
  "mail-transport-smtp.from.description":
    "Von dieser Adresse kommen die Mails, zum Beispiel status@example.com. Ihr Anbieter muss sie erlauben.",
  "tier-admin.explainer":
    "Weisen Sie einem Mandanten ein Tier ohne Kauf zu. Die manuelle Zuweisung bleibt bestehen, auch wenn sich die Abrechnung später automatisch aktualisiert.",
  "inboundMail.imap.connect.errors.hostUnreachable":
    "Der IMAP-Server ist nicht erreichbar oder nicht erlaubt. Prüfen Sie den Servernamen.",
  "inboundMail.imap.connect.errors.loginRejected":
    "Der IMAP-Server hat die Anmeldung abgelehnt. Prüfen Sie Benutzername und Passwort.",
  "inboundMail.imap.connect.errors.tlsFailed":
    "Die verschlüsselte Verbindung ist fehlgeschlagen. Prüfen Sie Port und TLS-Einstellung.",
  "inboundMail.imap.connect.errors.connectFailed":
    "Keine Verbindung zum IMAP-Server. Prüfen Sie Servernamen und Port.",
  "inboundMail.imap.connect.outgoingHint":
    "Antworten gehen von dieser Adresse über Ihren eigenen Mailserver raus, mit demselben Benutzernamen und Passwort. Lassen Sie das Feld leer, wenn der Server wie der IMAP-Server heißt, nur mit smtp. statt imap. Meist 587, auch wenn Ihr Anbieter 465/SSL nennt.",
  "inboundMail.imap.connect.errors.smtpHostUnreachable":
    "Empfang ok, Senden geht nicht: Der Postausgangsserver ist nicht erreichbar oder nicht erlaubt. Prüfen Sie seinen Namen.",
  "inboundMail.send.errors.notConfigured":
    "Senden ist für dieses Postfach nicht eingerichtet. Verbinden Sie das Postfach erneut mit seinem Postausgangsserver.",
  "inboundMail.send.errors.loginRejected":
    "Der Postausgangsserver hat die Anmeldung abgelehnt. Prüfen Sie das Passwort des Postfachs.",
  "inboundMail.send.errors.serverUnreachable":
    "Der Postausgangsserver ist nicht erreichbar. Versuchen Sie es später noch einmal.",
  "inboundMail.send.errors.rejected":
    "Der Postausgangsserver hat die Mail abgelehnt. Prüfen Sie die Empfängeradresse.",
};

export function germanBundleFor(address: GermanAddress): Readonly<Record<string, string>> {
  if (address === "informal") return localeDeBundle;
  return { ...localeDeBundle, ...localeDeFormalOverrides };
}
