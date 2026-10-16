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
};
