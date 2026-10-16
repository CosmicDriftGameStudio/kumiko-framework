// @runtime client
// Key-first bundle shared by the server feature (r.translations) and the client plugin.

type Localized = { readonly en: string; readonly de: string };

export const DOCUMENT_DESIGNER_I18N: Readonly<Record<string, Localized>> = {
  "screen:templates.title": { en: "Templates", de: "Vorlagen" },
  "screen:platform-templates.title": { en: "System templates", de: "System-Vorlagen" },
  "screen:layout-editor.title": { en: "Layout", de: "Layout" },
  "screen:pdf-template-editor.title": { en: "PDF template", de: "PDF-Vorlage" },
  "document-designer:nav.templates": { en: "Templates", de: "Vorlagen" },
  "document-designer:nav.platformTemplates": { en: "System templates", de: "System-Vorlagen" },
  "documentDesigner.screen.layoutEditor.description": {
    en: "Edit the mail layout or the PDF letterhead.",
    de: "Mail-Layout oder Briefpapier bearbeiten.",
  },
  "documentDesigner.search": { en: "Search templates", de: "Vorlagen suchen" },
  "documentDesigner.action.edit": { en: "Edit", de: "Bearbeiten" },

  "documentDesigner.col.template": { en: "Template", de: "Vorlage" },
  "documentDesigner.col.kind": { en: "Kind", de: "Art" },
  "documentDesigner.col.origin": { en: "Origin", de: "Herkunft" },
  "documentDesigner.col.locales": { en: "Languages", de: "Sprachen" },
  "documentDesigner.col.status": { en: "Status", de: "Status" },
  "documentDesigner.col.usedBy": { en: "Used by", de: "Verwendet von" },
  "documentDesigner.col.modifiedAt": { en: "Changed", de: "Geändert" },
  "documentDesigner.col.overriddenBy": { en: "Customised by", de: "Angepasst von" },
  "documentDesigner.facet.kind": { en: "Kind", de: "Art" },
  "documentDesigner.facet.origin": { en: "Origin", de: "Herkunft" },
  "documentDesigner.facet.status": { en: "Status", de: "Status" },

  "documentDesigner.kind.mail": { en: "Mail", de: "Mail" },
  "documentDesigner.kind.pdf": { en: "PDF", de: "PDF" },
  "documentDesigner.kind.layout": { en: "Layout", de: "Layout" },
  "documentDesigner.source.system": { en: "System", de: "System" },
  "documentDesigner.source.tenant": { en: "Tenant", de: "Mandant" },
  "documentDesigner.status.active": { en: "Active", de: "Aktiv" },
  "documentDesigner.status.draft": { en: "Draft", de: "Entwurf" },
  "documentDesigner.status.archived": { en: "Archived", de: "Archiviert" },
  "documentDesigner.status.activeVersion": { en: "Active v{version}", de: "Aktiv v{version}" },
  "documentDesigner.status.draftVersion": { en: "Draft v{version}", de: "Entwurf v{version}" },

  "documentDesigner.usedBy.allMails": { en: "all mails", de: "alle Mails" },
  "documentDesigner.usedBy.allPdfs": { en: "all PDFs", de: "alle PDFs" },
  "documentDesigner.usedBy.templates": { en: "{count} templates", de: "{count} Vorlagen" },
  "documentDesigner.usedBy.title": { en: "Used by", de: "Wird verwendet von" },
  "documentDesigner.usedBy.none": {
    en: "No template uses this layout yet.",
    de: "Noch keine Vorlage nutzt dieses Layout.",
  },
  "documentDesigner.overriddenBy.tenants": { en: "{active} tenants", de: "{active} Mandanten" },
  "documentDesigner.overriddenBy.ofTotal": {
    en: "{active} of {total} tenants",
    de: "{active} von {total} Mandanten",
  },

  "documentDesigner.branding.title": { en: "Tenant branding", de: "Branding des Mandanten" },
  "documentDesigner.branding.edit": { en: "Edit", de: "Bearbeiten" },
  "documentDesigner.branding.productName": { en: "Product name", de: "Produktname" },
  "documentDesigner.branding.accentColor": { en: "Accent colour", de: "Akzentfarbe" },
  "documentDesigner.branding.logo": { en: "Logo", de: "Logo" },
  "documentDesigner.branding.logoUploaded": { en: "Uploaded file", de: "Hochgeladene Datei" },
  "documentDesigner.branding.website": { en: "Website", de: "Website" },
  "documentDesigner.branding.notSet": { en: "not set", de: "nicht gesetzt" },
  "documentDesigner.branding.hint": {
    en: "One source for mail, PDF and web: the tenant's branding settings. The layout reads them but does not change them.",
    de: "Eine Quelle für Mail, PDF und Web: die Branding-Einstellungen des Mandanten. Das Layout greift darauf zu, ändert sie aber nicht.",
  },
  "documentDesigner.branding.unavailable": {
    en: "Branding is not available.",
    de: "Branding ist nicht verfügbar.",
  },

  "documentDesigner.layoutPlaceholders.title": {
    en: "Layout placeholders",
    de: "Layout-Platzhalter",
  },
  "documentDesigner.placeholders.content": { en: "Template content", de: "Inhalt der Vorlage" },
  "documentDesigner.placeholder.tenantName": { en: "Tenant name", de: "Mandantenname" },
  "documentDesigner.placeholder.signature": { en: "Signature", de: "Signatur" },
  "documentDesigner.placeholder.imprint": { en: "Imprint", de: "Impressum" },
  "documentDesigner.placeholder.unsubscribeUrl": { en: "Unsubscribe link", de: "Abmeldelink" },
  "documentDesigner.placeholder.page": { en: "Page number", de: "Seitenzahl" },
  "documentDesigner.placeholder.pages": { en: "Page count", de: "Seitenanzahl" },

  "documentDesigner.appearance.title": { en: "Appearance", de: "Darstellung" },
  "documentDesigner.appearance.width": { en: "Width", de: "Breite" },
  "documentDesigner.appearance.font": { en: "Font", de: "Schrift" },
  "documentDesigner.appearance.systemFont": {
    en: "System font (Helvetica, Arial)",
    de: "Systemschrift (Helvetica, Arial)",
  },
  "documentDesigner.appearance.background": { en: "Outer background", de: "Hintergrund außen" },
  "documentDesigner.appearance.backgroundValue": { en: "#f5f5f5", de: "#f5f5f5" },
  "documentDesigner.appearance.pageFormat": { en: "Page format", de: "Seitenformat" },
  "documentDesigner.appearance.hint": {
    en: "The appearance is fixed. Custom fonts and colours will follow.",
    de: "Darstellung ist fest vorgegeben. Eigene Schriften und Farben kommen später.",
  },
  "documentDesigner.mjml.title": { en: "MJML source", de: "MJML-Quelle" },

  "documentDesigner.editor.crumb": { en: "Templates", de: "Vorlagen" },
  "documentDesigner.editor.title.mail": { en: "Mail layout", de: "Mail-Layout" },
  "documentDesigner.editor.title.pdf": { en: "Letterhead", de: "Briefpapier" },
  "documentDesigner.editor.kindSwitch": { en: "Layout kind", de: "Layout-Art" },
  "documentDesigner.editor.kind.mail": { en: "Mail layout", de: "Mail-Layout" },
  "documentDesigner.editor.kind.pdf": { en: "Letterhead (PDF)", de: "Briefpapier (PDF)" },
  "documentDesigner.editor.tabSwitch": { en: "Editor mode", de: "Editor-Modus" },
  "documentDesigner.editor.tab.draft": { en: "Draft", de: "Entwurf" },
  "documentDesigner.editor.tab.mjml": { en: "MJML", de: "MJML" },
  "documentDesigner.editor.mjml.label": { en: "MJML source", de: "MJML-Quelle" },
  "documentDesigner.editor.mjmlNotice.platform": {
    en: "This system layout is written in MJML. Saving in the draft tab replaces it with a structured layout; edit the MJML tab to keep it.",
    de: "Dieses System-Layout ist in MJML geschrieben. Speichern im Entwurfs-Reiter ersetzt es durch ein strukturiertes Layout; im MJML-Reiter bleibt es MJML.",
  },
  "documentDesigner.editor.mjmlNotice.tenant": {
    en: "You see the system layout. Saving creates your own layout for this tenant.",
    de: "Sie sehen das System-Layout. Speichern legt ein eigenes Layout für Ihren Mandanten an.",
  },

  "documentDesigner.editor.origin.none": {
    en: "There is no layout yet.",
    de: "Es gibt noch kein Layout.",
  },
  "documentDesigner.editor.origin.system": {
    en: "You are looking at the system layout. Saving creates a customisation for your tenant.",
    de: "Sie sehen das System-Layout. Speichern legt eine Anpassung für Ihren Mandanten an.",
  },
  "documentDesigner.editor.origin.tenant.mails": {
    en: "Overrides system layout v{version}. Applies to {count} mail templates of this tenant.",
    de: "Überschreibt das System-Layout v{version}. Gilt für {count} Mail-Vorlagen dieses Mandanten.",
  },
  "documentDesigner.editor.origin.tenant.pdfs": {
    en: "Overrides system letterhead v{version}. Applies to {count} PDF templates of this tenant.",
    de: "Überschreibt das System-Briefpapier v{version}. Gilt für {count} PDF-Vorlagen dieses Mandanten.",
  },
  "documentDesigner.editor.origin.platformPlain": {
    en: "System layout v{version}",
    de: "System-Layout v{version}",
  },
  "documentDesigner.editor.origin.platformCount": {
    en: "System layout v{version} · {active} tenants have their own version",
    de: "System-Layout v{version} · {active} Mandanten haben eine eigene Fassung",
  },
  "documentDesigner.editor.origin.platformOfTotal": {
    en: "System layout v{version} · {active} of {total} tenants have their own version",
    de: "System-Layout v{version} · {active} von {total} Mandanten haben eine eigene Fassung",
  },

  "documentDesigner.editor.diff.open": {
    en: "Difference to the system layout",
    de: "Unterschied zum System-Layout",
  },
  "documentDesigner.editor.diff.title": {
    en: "Difference to the system layout",
    de: "Unterschied zum System-Layout",
  },
  "documentDesigner.editor.diff.identical": {
    en: "Your layout matches the system layout.",
    de: "Ihr Layout entspricht dem System-Layout.",
  },
  "documentDesigner.editor.reset.open": {
    en: "Reset to system layout",
    de: "Auf System-Layout zurücksetzen",
  },
  "documentDesigner.editor.reset.title": {
    en: "Reset to system layout?",
    de: "Auf System-Layout zurücksetzen?",
  },
  "documentDesigner.editor.reset.description": {
    en: "Your own layout is removed and the system layout applies again.",
    de: "Ihr eigenes Layout wird entfernt, danach gilt wieder das System-Layout.",
  },
  "documentDesigner.editor.reset.confirm": { en: "Reset", de: "Zurücksetzen" },

  "documentDesigner.editor.region.header": { en: "Header", de: "Kopf" },
  "documentDesigner.editor.region.content": { en: "Template content", de: "Inhalt der Vorlage" },
  "documentDesigner.editor.region.signature": { en: "Signature area", de: "Signatur-Bereich" },
  "documentDesigner.editor.region.footer": { en: "Footer", de: "Fuß" },
  "documentDesigner.editor.slot.mail": {
    en: "The content of every mail template is inserted here. Subject and preview text come from the template.",
    de: "Hier wird der Inhalt jeder Mail-Vorlage eingesetzt. Betreff und Vorschautext kommen aus der Vorlage.",
  },
  "documentDesigner.editor.slot.pdf": {
    en: "The content of every PDF template is inserted here.",
    de: "Hier wird der Inhalt jeder PDF-Vorlage eingesetzt.",
  },

  "documentDesigner.editor.footer.checking": {
    en: "Checking the layout …",
    de: "Layout wird geprüft …",
  },
  "documentDesigner.editor.footer.okMail": {
    en: "Content placeholder present. After publishing, the change applies to {count} templates.",
    de: "Inhalts-Platzhalter vorhanden. Änderung wirkt nach Veröffentlichen auf {count} Vorlagen.",
  },
  "documentDesigner.editor.footer.okPdf": {
    en: "Content placeholder present. After publishing, the change applies to {count} templates.",
    de: "Inhalts-Platzhalter vorhanden. Änderung wirkt nach Veröffentlichen auf {count} Vorlagen.",
  },
  "documentDesigner.editor.discard": { en: "Discard changes", de: "Änderungen verwerfen" },
  "documentDesigner.editor.save": { en: "Save", de: "Speichern" },
  "documentDesigner.editor.publish": { en: "Publish", de: "Veröffentlichen" },
  "documentDesigner.editor.dirtySwitch.title": {
    en: "Discard unsaved changes?",
    de: "Ungespeicherte Änderungen verwerfen?",
  },
  "documentDesigner.editor.dirtySwitch.description": {
    en: "Switching the layout kind discards your unsaved changes.",
    de: "Beim Wechsel der Layout-Art gehen Ihre ungespeicherten Änderungen verloren.",
  },
  "documentDesigner.editor.dirtySwitch.confirm": {
    en: "Discard and switch",
    de: "Verwerfen und wechseln",
  },

  "screen:mail-editor.title": {
    en: "Mail template",
    de: "Mail-Vorlage",
  },
  "documentDesigner.screen.mailEditor.description": {
    en: "Edit a mail template: subject, preview text, content, attachments, preview and test mail.",
    de: "Mail-Vorlage bearbeiten: Betreff, Vorschautext, Inhalt, Anhänge, Vorschau und Test-Mail.",
  },
  "documentDesigner.mail.header.localeSwitch": {
    en: "Language",
    de: "Sprache",
  },
  "documentDesigner.mail.header.modeSwitch": {
    en: "Mode",
    de: "Modus",
  },
  "documentDesigner.mail.header.edit": {
    en: "Edit",
    de: "Bearbeiten",
  },
  "documentDesigner.mail.header.preview": {
    en: "Preview",
    de: "Vorschau",
  },
  "documentDesigner.mail.header.testMail": {
    en: "Send test mail to me",
    de: "Test-Mail an mich",
  },
  "documentDesigner.mail.language.de": {
    en: "German",
    de: "Deutsch",
  },
  "documentDesigner.mail.language.en": {
    en: "English",
    de: "Englisch",
  },
  "documentDesigner.mail.language.es": {
    en: "Spanish",
    de: "Spanisch",
  },
  "documentDesigner.mail.origin.overrides": {
    en: 'Overrides the system template "{title}" v{version}.',
    de: "Überschreibt die System-Vorlage „{title}“ v{version}.",
  },
  "documentDesigner.mail.origin.tenantOnly": {
    en: "This template exists only for your tenant.",
    de: "Diese Vorlage gibt es nur für Ihren Mandanten.",
  },
  "documentDesigner.mail.origin.activeSince": {
    en: "Active since {when}.",
    de: "Aktiv seit {when}.",
  },
  "documentDesigner.mail.origin.notPublished": {
    en: "Not published yet.",
    de: "Noch nicht veröffentlicht.",
  },
  "documentDesigner.mail.origin.archived": {
    en: "Archived.",
    de: "Archiviert.",
  },
  "documentDesigner.mail.origin.reset": {
    en: "Reset to system template",
    de: "Auf System-Vorlage zurücksetzen",
  },
  "documentDesigner.mail.origin.system": {
    en: "You are viewing the system template v{version}. Saving creates a customisation for your tenant.",
    de: "Sie sehen die System-Vorlage v{version}. Speichern legt eine Anpassung für Ihren Mandanten an.",
  },
  "documentDesigner.mail.origin.platform": {
    en: "System template v{version}. Saving changes it for every tenant without a customisation.",
    de: "System-Vorlage v{version}. Speichern ändert sie für alle Mandanten ohne eigene Anpassung.",
  },
  "documentDesigner.mail.origin.missing": {
    en: "There is no own version for {language}. Recipients with language {locale} get the {fallback} version.",
    de: "Für {language} gibt es keine eigene Fassung. Empfänger mit Sprache {locale} bekommen die Fassung {fallback}.",
  },
  "documentDesigner.mail.origin.missingNoFallback": {
    en: "There is no own version for {language}.",
    de: "Für {language} gibt es keine eigene Fassung.",
  },
  "documentDesigner.mail.origin.copyNote": {
    en: "Copying a system version does not bring images or attachments along; upload them again afterwards.",
    de: "Beim Kopieren einer System-Fassung kommen Bilder und Anhänge nicht mit; laden Sie sie danach neu hoch.",
  },
  "documentDesigner.mail.origin.copyFrom": {
    en: "Copy from {fallback}",
    de: "Aus {fallback} kopieren",
  },
  "documentDesigner.mail.origin.createBlank": {
    en: "Start empty",
    de: "Leer anlegen",
  },
  "documentDesigner.mail.origin.creating": {
    en: "New version for {language}. It is stored when you save.",
    de: "Neue Fassung für {language}. Sie wird erst mit Speichern angelegt.",
  },
  "documentDesigner.mail.reset.title": {
    en: "Reset to the system template?",
    de: "Auf System-Vorlage zurücksetzen?",
  },
  "documentDesigner.mail.reset.description": {
    en: "Your customisation of this template is removed in all languages. The system template applies again.",
    de: "Ihre Anpassung dieser Vorlage wird in allen Sprachen entfernt. Danach gilt wieder die System-Vorlage.",
  },
  "documentDesigner.mail.reset.confirm": {
    en: "Reset",
    de: "Zurücksetzen",
  },
  "documentDesigner.mail.placeholder.title": {
    en: "Placeholders",
    de: "Platzhalter",
  },
  "documentDesigner.mail.placeholder.missing": {
    en: "missing",
    de: "fehlt",
  },
  "documentDesigner.mail.placeholder.hint": {
    en: "T text · € amount · D date · ↗ link · ≡ list. Asterisk: required, must appear in the content.",
    de: "T Text · € Geldbetrag · D Datum · ↗ Link · ≡ Liste. Sternchen: Pflicht, muss im Inhalt vorkommen.",
  },
  "documentDesigner.mail.system.title": {
    en: "System placeholders",
    de: "System-Platzhalter",
  },
  "documentDesigner.mail.resource.title": {
    en: "Resources",
    de: "Ressourcen",
  },
  "documentDesigner.mail.resource.upload": {
    en: "+ Upload",
    de: "+ Hochladen",
  },
  "documentDesigner.mail.resource.saveFirst": {
    en: "Save first, then upload.",
    de: "Erst speichern, dann hochladen.",
  },
  "documentDesigner.mail.resource.inline": {
    en: "Inline",
    de: "Inline",
  },
  "documentDesigner.mail.resource.attachment": {
    en: "Attachment",
    de: "Anhang",
  },
  "documentDesigner.mail.resource.fromPdf": {
    en: 'Attachment · from "{title}"',
    de: "Anhang · aus „{title}“",
  },
  "documentDesigner.mail.resource.remove": {
    en: "Remove",
    de: "Entfernen",
  },
  "documentDesigner.mail.resource.caption": {
    en: "{key} · embedded as CID",
    de: "{key} · als CID eingebettet",
  },
  "documentDesigner.mail.resource.hint": {
    en: "Inline images are sent as CID. Attachments from PDF templates are generated when the mail is sent.",
    de: "Inline-Bilder gehen als CID mit. Anhänge aus PDF-Vorlagen werden erst beim Versand erzeugt.",
  },
  "documentDesigner.mail.upload.title": {
    en: "Upload resource",
    de: "Ressource hochladen",
  },
  "documentDesigner.mail.upload.image": {
    en: "Image (inline)",
    de: "Bild (inline)",
  },
  "documentDesigner.mail.upload.imageHint": {
    en: "Embedded in the mail content as CID.",
    de: "Wird als CID in den Mail-Inhalt eingebettet.",
  },
  "documentDesigner.mail.upload.attachment": {
    en: "File attachment",
    de: "Datei-Anhang",
  },
  "documentDesigner.mail.upload.attachmentHint": {
    en: "Sent with every mail of this template (PDF, PNG or JPEG).",
    de: "Wird an jede Mail dieser Vorlage angehängt (PDF, PNG oder JPEG).",
  },
  "documentDesigner.mail.upload.busy": {
    en: "Uploading …",
    de: "Wird hochgeladen …",
  },
  "documentDesigner.mail.upload.noFileName": {
    en: "The file name could not be read. Please try again.",
    de: "Der Dateiname konnte nicht gelesen werden. Bitte erneut versuchen.",
  },
  "documentDesigner.mail.remove.title": {
    en: "Remove resource?",
    de: "Ressource entfernen?",
  },
  "documentDesigner.mail.remove.description": {
    en: "The image or attachment is removed from this template.",
    de: "Das Bild oder der Anhang wird aus dieser Vorlage entfernt.",
  },
  "documentDesigner.mail.remove.confirm": {
    en: "Remove",
    de: "Entfernen",
  },
  "documentDesigner.mail.meta.subject": {
    en: "Subject",
    de: "Betreff",
  },
  "documentDesigner.mail.meta.previewText": {
    en: "Preview text",
    de: "Vorschautext",
  },
  "documentDesigner.mail.props.title": {
    en: "Properties",
    de: "Eigenschaften",
  },
  "documentDesigner.mail.props.layout": {
    en: "Layout",
    de: "Layout",
  },
  "documentDesigner.mail.props.layoutTenant": {
    en: "{title} (tenant customisation v{version})",
    de: "{title} (Tenant-Anpassung v{version})",
  },
  "documentDesigner.mail.props.layoutSystem": {
    en: "{title} (system v{version})",
    de: "{title} (System v{version})",
  },
  "documentDesigner.mail.props.sender": {
    en: "Sender",
    de: "Absender",
  },
  "documentDesigner.mail.props.senderDefault": {
    en: "Default sender of the tenant",
    de: "Standard-Absender des Mandanten",
  },
  "documentDesigner.mail.props.category": {
    en: "Category",
    de: "Kategorie",
  },
  "documentDesigner.mail.props.transactional": {
    en: "Transactional",
    de: "Transaktional",
  },
  "documentDesigner.mail.props.marketing": {
    en: "Marketing",
    de: "Marketing",
  },
  "documentDesigner.mail.props.categoryHint": {
    en: 'Transactional mails need no unsubscribe link. With "Marketing" the layout must provide one.',
    de: "Transaktionale Mails brauchen keinen Abmeldelink. Bei „Marketing“ muss das Layout den Abmeldelink liefern.",
  },
  "documentDesigner.mail.attachments.title": {
    en: "Attachments",
    de: "Anhänge",
  },
  "documentDesigner.mail.attachments.none": {
    en: "No attachments",
    de: "Keine Anhänge",
  },
  "documentDesigner.mail.attachments.addPdf": {
    en: "+ Attachment from PDF template",
    de: "+ Anhang aus PDF-Vorlage",
  },
  "documentDesigner.mail.attachments.pdfRow": {
    en: "{title} (PDF template)",
    de: "{title} (PDF-Vorlage)",
  },
  "documentDesigner.mail.attachments.file": {
    en: "File",
    de: "Datei",
  },
  "documentDesigner.mail.pdfLink.title": {
    en: "Attachment from PDF template",
    de: "Anhang aus PDF-Vorlage",
  },
  "documentDesigner.mail.pdfLink.template": {
    en: "PDF template",
    de: "PDF-Vorlage",
  },
  "documentDesigner.mail.pdfLink.fileName": {
    en: "File name",
    de: "Dateiname",
  },
  "documentDesigner.mail.pdfLink.fileNameHint": {
    en: "May contain placeholders and must end with .pdf. The PDF is generated when the mail is sent.",
    de: "Darf Platzhalter enthalten und muss auf .pdf enden. Das PDF wird erst beim Versand erzeugt.",
  },
  "documentDesigner.mail.pdfLink.confirm": {
    en: "Add attachment",
    de: "Anhang hinzufügen",
  },
  "documentDesigner.mail.pdfLink.none": {
    en: "There are no PDF templates yet.",
    de: "Es gibt noch keine PDF-Vorlagen.",
  },
  "documentDesigner.mail.usage.title": {
    en: "Usage",
    de: "Verwendung",
  },
  "documentDesigner.mail.usage.line": {
    en: 'Feature "{feature}", event "{notification}"',
    de: "Feature „{feature}“, Ereignis „{notification}“",
  },
  "documentDesigner.mail.usage.hint": {
    en: "The feature provides the placeholders. What is not listed here cannot be used in the template.",
    de: "Platzhalter liefert das Feature. Was hier nicht steht, kann die Vorlage nicht verwenden.",
  },
  "documentDesigner.mail.versions.title": {
    en: "Versions",
    de: "Versionen",
  },
  "documentDesigner.mail.versions.line": {
    en: "v{version} {when}, {name}",
    de: "v{version} {when}, {name}",
  },
  "documentDesigner.mail.footer.missing": {
    en: 'Required placeholder "{names}" is missing in subject, preview text and content. Publishing is blocked.',
    de: "Pflicht-Platzhalter „{names}“ fehlt in Betreff, Vorschautext und Inhalt. Veröffentlichen ist gesperrt.",
  },
  "documentDesigner.mail.footer.missingPreview": {
    en: 'Required placeholder "{names}" is missing. Publishing is blocked, a test mail is possible.',
    de: "Pflicht-Platzhalter „{names}“ fehlt. Veröffentlichen ist gesperrt, Test-Mail ist möglich.",
  },
  "documentDesigner.mail.footer.ok": {
    en: "Ready to publish.",
    de: "Bereit zum Veröffentlichen.",
  },
  "documentDesigner.mail.footer.savedAt": {
    en: "Last saved {when}",
    de: "Zuletzt gespeichert {when}",
  },
  "documentDesigner.mail.discard.title": {
    en: "Discard changes?",
    de: "Änderungen verwerfen?",
  },
  "documentDesigner.mail.discard.description": {
    en: "Your unsaved changes are lost.",
    de: "Ihre ungespeicherten Änderungen gehen verloren.",
  },
  "documentDesigner.mail.discard.confirm": {
    en: "Discard",
    de: "Verwerfen",
  },
  "documentDesigner.mail.activeSave.title": {
    en: "Save as draft?",
    de: "Als Entwurf speichern?",
  },
  "documentDesigner.mail.activeSave.description": {
    en: "Saving as a draft takes the active customisation offline until you publish. Publish instead?",
    de: "Speichern als Entwurf nimmt die aktive Anpassung offline, bis Sie veröffentlichen. Stattdessen veröffentlichen?",
  },
  "documentDesigner.mail.activeSave.confirm": {
    en: "Save as draft",
    de: "Als Entwurf speichern",
  },
  "documentDesigner.mail.leave.title": {
    en: "Unsaved changes",
    de: "Ungespeicherte Änderungen",
  },
  "documentDesigner.mail.leave.description": {
    en: "Save your changes as a draft, discard them or stay on this page.",
    de: "Speichern Sie Ihre Änderungen als Entwurf, verwerfen Sie sie oder bleiben Sie auf dieser Seite.",
  },
  "documentDesigner.mail.leave.save": {
    en: "Save as draft",
    de: "Als Entwurf speichern",
  },
  "documentDesigner.mail.leave.discard": {
    en: "Discard",
    de: "Verwerfen",
  },
  "documentDesigner.mail.preview.bar": {
    en: 'Preview with sample values from the placeholder schema. Rendered through "{layout}".',
    de: "Vorschau mit Beispielwerten aus dem Platzhalter-Schema. Gerendert über „{layout}“.",
  },
  "documentDesigner.mail.preview.barPlain": {
    en: "Preview with sample values from the placeholder schema.",
    de: "Vorschau mit Beispielwerten aus dem Platzhalter-Schema.",
  },
  "documentDesigner.mail.preview.formatSwitch": {
    en: "Format",
    de: "Format",
  },
  "documentDesigner.mail.preview.html": {
    en: "HTML",
    de: "HTML",
  },
  "documentDesigner.mail.preview.text": {
    en: "Text only",
    de: "Nur Text",
  },
  "documentDesigner.mail.preview.widthSwitch": {
    en: "Width",
    de: "Breite",
  },
  "documentDesigner.mail.preview.desktop": {
    en: "Desktop",
    de: "Desktop",
  },
  "documentDesigner.mail.preview.mobile": {
    en: "Mobile 375 px",
    de: "Mobil 375 px",
  },
  "documentDesigner.mail.preview.attachments": {
    en: "Attachment",
    de: "Anhang",
  },
  "documentDesigner.mail.preview.generatedOnSend": {
    en: "generated when sent",
    de: "wird beim Versand erzeugt",
  },
  "documentDesigner.mail.preview.frameTitle": {
    en: "Mail preview",
    de: "Mail-Vorschau",
  },
  "documentDesigner.mail.preview.samples": {
    en: "Sample values",
    de: "Beispielwerte",
  },
  "documentDesigner.mail.preview.samplesHint": {
    en: "Money and dates are formatted by the tenant settings.",
    de: "Geld und Datum werden nach den Mandanten-Einstellungen formatiert.",
  },
  "documentDesigner.mail.preview.missingInContent": {
    en: "missing in content",
    de: "fehlt im Inhalt",
  },
  "documentDesigner.mail.preview.entries": {
    en: "{count} entries",
    de: "{count} Einträge",
  },
  "documentDesigner.mail.preview.checks": {
    en: "Checks",
    de: "Prüfung",
  },
  "documentDesigner.mail.testMail.title": {
    en: "Test mail",
    de: "Test-Mail",
  },
  "documentDesigner.mail.testMail.recipient": {
    en: "Recipient",
    de: "Empfänger",
  },
  "documentDesigner.mail.testMail.ownAddress": {
    en: "Your address",
    de: "Ihre Adresse",
  },
  "documentDesigner.mail.testMail.prefix": {
    en: "Subject with [TEST] prefix",
    de: "Betreff mit Präfix [TEST]",
  },
  "documentDesigner.mail.testMail.attachments": {
    en: "Attachments are sent along",
    de: "Anhänge werden mitgesendet",
  },
  "documentDesigner.mail.testMail.send": {
    en: "Send test mail",
    de: "Test-Mail senden",
  },
  "documentDesigner.mail.testMail.hint": {
    en: "Sent through the tenant's normal delivery path to your own address.",
    de: "Versand über den normalen Zustellweg des Mandanten an Ihre eigene Adresse.",
  },
  "documentDesigner.mail.testMail.sent": {
    en: "Test mail sent to your address: {subject}",
    de: "Test-Mail an Ihre Adresse gesendet: {subject}",
  },
  "documentDesigner.mail.testMail.rateLimited": {
    en: "Too many test mails, please try again later.",
    de: "Zu viele Test-Mails, bitte später erneut versuchen.",
  },
};
