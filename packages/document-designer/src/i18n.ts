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
  "documentDesigner.origin.system": { en: "System template", de: "System-Vorlage" },
  "documentDesigner.origin.override": { en: "Customised", de: "Mandanten-Anpassung" },
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
  "documentDesigner.appearance.background": { en: "Outer background", de: "Hintergrund außen" },
  "documentDesigner.appearance.font.sans": {
    en: "System font (Arial, Helvetica)",
    de: "Systemschrift (Arial, Helvetica)",
  },
  "documentDesigner.appearance.font.serif": {
    en: "Serif font (Georgia)",
    de: "Serifenschrift (Georgia)",
  },
  "documentDesigner.appearance.fontHint": {
    en: "Custom fonts in mails come later. PDF uses the bundled framework font.",
    de: "Eigene Schriften in Mails kommen sp\u00e4ter. PDF nutzt die geb\u00fcndelte Schrift des Frameworks.",
  },
  "documentDesigner.appearance.backgroundInvalid": {
    en: "Enter a colour like #f3f2ee.",
    de: "Eine Farbe wie #f3f2ee angeben.",
  },
  "documentDesigner.appearance.accentLine": {
    en: "Accent line at the top",
    de: "Akzentlinie oben",
  },
  "documentDesigner.appearance.accentLine.branding": {
    en: "Accent colour from branding",
    de: "Akzentfarbe aus Branding",
  },
  "documentDesigner.appearance.accentLine.none": { en: "None", de: "Keine" },
  "documentDesigner.appearance.buttonStyle": { en: "Button style", de: "Button-Stil" },
  "documentDesigner.appearance.buttonStyle.filled-rounded": {
    en: "Filled, rounded",
    de: "Gef\u00fcllt, abgerundet",
  },
  "documentDesigner.appearance.buttonStyle.filled-square": {
    en: "Filled, square",
    de: "Gef\u00fcllt, eckig",
  },
  "documentDesigner.appearance.buttonStyle.outline": { en: "Outline", de: "Umriss" },
  "documentDesigner.appearance.fromMjml": {
    en: "The appearance comes from this layout's MJML source.",
    de: "Die Darstellung kommt aus der MJML-Quelle dieses Layouts.",
  },
  "documentDesigner.mjml.title": { en: "MJML source", de: "MJML-Quelle" },
  "documentDesigner.mjml.hint": {
    en: "Platform admins can edit the MJML source directly. Tenants only see the draft mode.",
    de: "Plattform-Admins k\u00f6nnen die MJML-Quelle direkt bearbeiten. Mandanten sehen nur den Entwurfs-Modus.",
  },
  "documentDesigner.renderer.title": { en: "Renderer", de: "Renderer" },
  "documentDesigner.renderer.mjml": { en: "MJML", de: "MJML" },
  "documentDesigner.renderer.chromium": { en: "Chromium (PDF)", de: "Chromium (PDF)" },
  "documentDesigner.renderer.active": { en: "active", de: "aktiv" },

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
    de: "Du siehst das System-Layout. Speichern legt ein eigenes Layout für deinen Mandanten an.",
  },

  "documentDesigner.editor.origin.none": {
    en: "There is no layout yet.",
    de: "Es gibt noch kein Layout.",
  },
  "documentDesigner.editor.origin.system": {
    en: "You are looking at the system layout. Saving creates a customisation for your tenant.",
    de: "Du siehst das System-Layout. Speichern legt eine Anpassung für deinen Mandanten an.",
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
    en: "Show difference",
    de: "Unterschied anzeigen",
  },
  "documentDesigner.editor.diff.title": {
    en: "Difference to the system layout",
    de: "Unterschied zum System-Layout",
  },
  "documentDesigner.editor.diff.identical": {
    en: "Your layout matches the system layout.",
    de: "Dein Layout entspricht dem System-Layout.",
  },
  "documentDesigner.editor.reset.open": {
    en: "Reset",
    de: "Zurücksetzen",
  },
  "documentDesigner.editor.reset.title": {
    en: "Reset to system layout?",
    de: "Auf System-Layout zurücksetzen?",
  },
  "documentDesigner.editor.reset.description": {
    en: "Your own layout is removed and the system layout applies again.",
    de: "Dein eigenes Layout wird entfernt, danach gilt wieder das System-Layout.",
  },
  "documentDesigner.editor.reset.confirm": { en: "Reset", de: "Zurücksetzen" },

  "documentDesigner.editor.region.header": { en: "Header", de: "Kopf" },
  "documentDesigner.editor.logoCaption": {
    en: "Logo · from branding, max. 180 px wide",
    de: "Logo · aus Branding, max. 180 px breit",
  },
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
    de: "Beim Wechsel der Layout-Art gehen deine ungespeicherten Änderungen verloren.",
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
    en: "Overrides the system template v{version}.",
    de: "Überschreibt die System-Vorlage v{version}.",
  },
  "documentDesigner.mail.origin.tenantOnly": {
    en: "This template exists only for your tenant.",
    de: "Diese Vorlage gibt es nur für deinen Mandanten.",
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
    en: "Reset",
    de: "Zurücksetzen",
  },
  "documentDesigner.mail.origin.system": {
    en: "You are viewing the system template v{version}. Saving creates a customisation for your tenant.",
    de: "Du siehst die System-Vorlage v{version}. Speichern legt eine Anpassung für deinen Mandanten an.",
  },
  "documentDesigner.mail.origin.platform": {
    en: "System template v{version}. Saving changes it for every tenant without a customisation.",
    de: "System-Vorlage v{version}. Speichern ändert sie für alle Mandanten ohne eigene Anpassung.",
  },
  "documentDesigner.mail.origin.missing": {
    en: "There is no version for {language} yet.",
    de: "Für {language} gibt es noch keine Fassung.",
  },
  "documentDesigner.mail.missing.text": {
    en: "There is no version for {language} yet. Recipients with language {locale} get the {fallbackAdjective} version.",
    de: "Für {language} gibt es noch keine Fassung. Empfänger mit Sprache {locale} bekommen die {fallbackAdjective} Fassung.",
  },
  "documentDesigner.mail.missing.textNoFallback": {
    en: "There is no version for {language} yet.",
    de: "Für {language} gibt es noch keine Fassung.",
  },
  "documentDesigner.mail.missing.copy": {
    en: "Copy from {language}",
    de: "Aus {language} kopieren",
  },
  "documentDesigner.mail.languageAdjective.de": {
    en: "German",
    de: "deutsche",
  },
  "documentDesigner.mail.languageAdjective.en": {
    en: "English",
    de: "englische",
  },
  "documentDesigner.mail.languageAdjective.es": {
    en: "Spanish",
    de: "spanische",
  },
  "documentDesigner.mail.origin.copyNote": {
    en: "Copying a system version does not bring images or attachments along; upload them again afterwards.",
    de: "Beim Kopieren einer System-Fassung kommen Bilder und Anhänge nicht mit; lade sie danach neu hoch.",
  },
  "documentDesigner.mail.origin.createBlank": {
    en: "Start empty",
    de: "Leer anlegen",
  },
  "documentDesigner.mail.origin.creating": {
    en: "New version for {language}. It is stored when you save.",
    de: "Neue Fassung für {language}. Die Fassung wird erst mit Speichern angelegt.",
  },
  "documentDesigner.mail.reset.title": {
    en: "Reset to the system template?",
    de: "Auf System-Vorlage zurücksetzen?",
  },
  "documentDesigner.mail.reset.description": {
    en: "Your customisation of this template is removed in all languages. The system template applies again.",
    de: "Deine Anpassung dieser Vorlage wird in allen Sprachen entfernt. Danach gilt wieder die System-Vorlage.",
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
  "documentDesigner.mail.system.layout": {
    en: "Layout",
    de: "Layout",
  },
  "documentDesigner.mail.system.hint": {
    en: "Filled in by the platform. Imprint and unsubscribe link come from the layout.",
    de: "Füllt die Plattform. Impressum und Abmeldelink liefert das Layout.",
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
  "documentDesigner.mail.resource.noFilesFeature": {
    en: "Uploads need the files feature, which this app has not mounted.",
    de: "Uploads brauchen das Files-Feature, das diese App nicht eingebunden hat.",
  },
  "documentDesigner.mail.testMail.unavailable.noChannel": {
    en: "Test mails need the email channel, which this app has not mounted.",
    de: "Test-Mails brauchen den E-Mail-Kanal, den diese App nicht eingebunden hat.",
  },
  "documentDesigner.mail.testMail.unavailable.noAddress": {
    en: "No email address is stored for you, so no test mail can be sent.",
    de: "Für dich ist keine E-Mail-Adresse hinterlegt, daher kann keine Test-Mail gesendet werden.",
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
    en: "{key} · {size} · embedded as CID",
    de: "{key} · {size} · als CID eingebettet",
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
  "documentDesigner.mail.meta.previewTextPlaceholder": {
    en: "Short line shown next to the subject in the inbox",
    de: "Kurze Zeile, die im Posteingang neben dem Betreff erscheint",
  },
  "documentDesigner.mail.props.title": {
    en: "Properties",
    de: "Eigenschaften",
  },
  "documentDesigner.mail.props.layout": {
    en: "Layout",
    de: "Layout",
  },
  "documentDesigner.mail.props.layoutBuiltIn": {
    en: "Standard layout (built in)",
    de: "Standard-Layout (eingebaut)",
  },
  "documentDesigner.mail.props.layoutTenant": {
    en: "{title} (tenant customisation v{version})",
    de: "{title} (Mandanten-Anpassung v{version})",
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
  "documentDesigner.mail.props.senderPlaceholder": {
    en: "Name shown to recipients",
    de: "Name, den Empfänger sehen",
  },
  "documentDesigner.mail.props.senderHint": {
    en: "The address comes from the platform's mail delivery.",
    de: "Die Adresse kommt vom Mail-Versand der Plattform.",
  },
  "documentDesigner.mail.props.senderHintTenant": {
    en: "The address comes from your organization's email sending settings.",
    de: "Die Adresse kommt aus dem E-Mail-Versand deines Mandanten.",
  },
  "documentDesigner.mail.props.senderSettingsLink": {
    en: "Open email sending",
    de: "E-Mail-Versand öffnen",
  },
  "documentDesigner.mail.props.replyTo": {
    en: "Reply to",
    de: "Antwort an",
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
  "documentDesigner.mail.chrome.title": {
    en: "Header and footer",
    de: "Kopf und Fuß",
  },
  "documentDesigner.mail.chrome.headerChip": {
    en: "Label in the header",
    de: "Kennzeichen im Kopf",
  },
  "documentDesigner.mail.chrome.headerChipPlaceholder": {
    en: "e.g. New incident",
    de: "z. B. Neuer Incident",
  },
  "documentDesigner.mail.chrome.tone": {
    en: "Tone",
    de: "Farbton",
  },
  "documentDesigner.mail.chrome.toneAccent": {
    en: "Accent colour (default)",
    de: "Akzentfarbe (Standard)",
  },
  "documentDesigner.mail.chrome.toneInfo": {
    en: "Info (blue grey)",
    de: "Info (blaugrau)",
  },
  "documentDesigner.mail.chrome.toneSuccess": {
    en: "Success (green)",
    de: "Erfolg (grün)",
  },
  "documentDesigner.mail.chrome.toneWarning": {
    en: "Warning (amber)",
    de: "Warnung (gelb)",
  },
  "documentDesigner.mail.chrome.toneDanger": {
    en: "Danger (red)",
    de: "Gefahr (rot)",
  },
  "documentDesigner.mail.chrome.toneNeutral": {
    en: "Neutral (grey)",
    de: "Neutral (grau)",
  },
  "documentDesigner.mail.chrome.toneFromPlaceholder": {
    en: "From placeholder: {value}",
    de: "Aus Platzhalter: {value}",
  },
  "documentDesigner.mail.chrome.footerNote": {
    en: "Note in the footer",
    de: "Hinweis im Fuß",
  },
  "documentDesigner.mail.chrome.footerNotePlaceholder": {
    en: "e.g. why the recipient gets this mail",
    de: "z. B. warum der Empfänger diese Mail bekommt",
  },
  "documentDesigner.mail.chrome.hint": {
    en: "The label sits right of the logo; the tone colours it and the line at the top. The note stands above the website and unsubscribe links. Layouts with their own MJML code show neither.",
    de: "Das Kennzeichen steht rechts neben dem Logo, der Farbton färbt es und die Linie oben. Der Hinweis steht über den Links zur Website und zum Abmelden. Layouts mit eigenem MJML-Code zeigen beides nicht.",
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
  "documentDesigner.mail.attachments.hint": {
    en: "PDF templates are generated when the mail is sent; files go out as uploaded.",
    de: "PDF-Vorlagen werden beim Versand erzeugt, Dateien gehen so mit, wie sie hochgeladen wurden.",
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
  "documentDesigner.mail.versions.hint": {
    en: "Every save creates a new version. The active one is what recipients get.",
    de: "Jedes Speichern legt eine neue Version an. Aktiv ist die Version, die Empfänger bekommen.",
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
    de: "Deine ungespeicherten Änderungen gehen verloren.",
  },
  "documentDesigner.mail.discard.confirm": {
    en: "Discard",
    de: "Verwerfen",
  },
  "documentDesigner.origin.draftBesideActive": {
    en: "Version {active} is sent, your draft (version {draft}) is not published yet.",
    de: "Verschickt wird Version {active}, dein Entwurf (Version {draft}) ist noch nicht veröffentlicht.",
  },
  "documentDesigner.mail.leave.title": {
    en: "Unsaved changes",
    de: "Ungespeicherte Änderungen",
  },
  "documentDesigner.mail.leave.description": {
    en: "Save your changes as a draft, discard them or stay on this page.",
    de: "Speichere deine Änderungen als Entwurf, verwirf sie oder bleib auf dieser Seite.",
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
    en: 'Preview with sample values from the placeholder schema. Rendered through "Mail layout v{version}", renderer: MJML.',
    de: "Vorschau mit Beispielwerten aus dem Platzhalter-Schema. Gerendert über „Mail-Layout v{version}“, Renderer: MJML.",
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
  "documentDesigner.mail.preview.from": {
    en: "From",
    de: "Von",
  },
  "documentDesigner.mail.preview.to": {
    en: "To",
    de: "An",
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
  "documentDesigner.mail.preview.checksHint": {
    en: "What the server found while rendering this mail.",
    de: "Das hat der Server beim Rendern dieser Mail gefunden.",
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
    de: "Deine Adresse",
  },
  "documentDesigner.mail.testMail.changeAddress": {
    en: "Change address",
    de: "Adresse ändern",
  },
  "documentDesigner.mail.testMail.prefixSubject": {
    en: "Prefix the subject with [TEST]",
    de: "Betreff mit Präfix [TEST]",
  },
  "documentDesigner.mail.testMail.attachments": {
    en: "Send attachments along",
    de: "Anhang mitsenden",
  },
  "documentDesigner.mail.testMail.noAttachments": {
    en: "This template has no attachments",
    de: "Diese Vorlage hat keine Anhänge",
  },
  "documentDesigner.mail.testMail.send": {
    en: "Send test mail",
    de: "Test-Mail senden",
  },
  "documentDesigner.mail.testMail.hint": {
    en: "Sent through the tenant's normal delivery path to your own address.",
    de: "Versand über den normalen Zustellweg des Mandanten an deine eigene Adresse.",
  },
  "documentDesigner.mail.testMail.sent": {
    en: "Test mail sent to your address: {subject}",
    de: "Test-Mail an deine Adresse gesendet: {subject}",
  },
  "documentDesigner.mail.testMail.rateLimited": {
    en: "Too many test mails, please try again later.",
    de: "Zu viele Test-Mails, bitte später erneut versuchen.",
  },
};
