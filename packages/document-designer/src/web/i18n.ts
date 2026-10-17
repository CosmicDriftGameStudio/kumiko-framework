// @runtime client
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const documentDesignerTranslations: TranslationsByLocale = {
  en: {
    "documentDesigner.actions.generatePdf": "Generate PDF",
    "documentDesigner.canvas.caption":
      'Page 1 · {format} · The preview shows page breaks only roughly; "Generate PDF" is authoritative.',
    "documentDesigner.canvas.fromLayout": 'from layout "{layout}"',
    "documentDesigner.error.resourceTooLarge":
      "The image is too large. Please choose a smaller file.",
    "documentDesigner.error.resourceUnsupportedImage":
      "This image format is not supported. Use PNG, JPEG, GIF or WebP.",
    "documentDesigner.locale": "Language",
    "documentDesigner.localeDialog.cancel": "Cancel",
    "documentDesigner.localeDialog.description":
      "The changes of this language have not been saved yet.",
    "documentDesigner.localeDialog.discard": "Discard changes",
    "documentDesigner.localeDialog.save": "Save and switch",
    "documentDesigner.localeDialog.title": "Unsaved changes",
    "documentDesigner.notFound": 'Template "{slug}" was not found.',
    "documentDesigner.originBar.export": "Export as bundle",
    "documentDesigner.originBar.noTotal":
      "System template for all tenants. {count} tenants have their own version and do not receive changes made here.",
    "documentDesigner.originBar.withTotal":
      "System template for all tenants. {count} of {total} tenants have their own version and do not receive changes made here.",
    "documentDesigner.originBar.showOverrides": "Show tenant customisations",
    "documentDesigner.overrides.action.diff": "Show difference",
    "documentDesigner.overrides.action.open": "Open",
    "documentDesigner.overrides.back": "Back to the list",
    "documentDesigner.overrides.column.changed": "Changed",
    "documentDesigner.overrides.column.status": "Status",
    "documentDesigner.overrides.column.tenant": "Tenant",
    "documentDesigner.overrides.column.version": "Version",
    "documentDesigner.overrides.detail.version": "{tenant}, version {version}",
    "documentDesigner.overrides.empty":
      "No tenant has customised this template. Changes here apply to everyone.",
    "documentDesigner.overrides.status.active": "Customised",
    "documentDesigner.overrides.status.draft": "Draft",
    "documentDesigner.overrides.summary": "{count} tenants have their own version.",
    "documentDesigner.overrides.title": "Tenant customisations",
    "documentDesigner.overrides.usedBy": "Used by",
    "documentDesigner.overrides.usedByEmpty":
      "No registered notification uses this template directly.",
    "documentDesigner.pdfUnavailable": "PDF generation is not available: {message}",
    "documentDesigner.pdfUnavailableNoReason": "PDF generation is not available.",
    "documentDesigner.placeholders.layoutHint":
      'Images travel with the PDF as data URIs. Header and footer come from the layout "{layout}" and are the same on every page.',
    "documentDesigner.preview.loading": "Generating PDF...",
    "documentDesigner.preview.pageOf": "Page {page} of {pages}",
    "documentDesigner.preview.renderFailed": "The PDF could not be displayed.",
    "documentDesigner.preview.stale": "The preview is out of date. Generate the PDF again.",
    "documentDesigner.resources.empty": "No images yet.",
    "documentDesigner.resources.saveFirst": "Save the template first, then you can upload images.",
    "documentDesigner.resources.title": "Resources",
    "documentDesigner.resources.upload": "+ Upload",
    "documentDesigner.settings.fileName": "File name",
    "documentDesigner.settings.landscape": "Landscape",
    "documentDesigner.settings.layout": "Layout",
    "documentDesigner.settings.layoutHeaderFooter": "Header and footer from layout",
    "documentDesigner.settings.marginBottom": "Bottom (mm)",
    "documentDesigner.settings.marginLeft": "Left (mm)",
    "documentDesigner.settings.marginRight": "Right (mm)",
    "documentDesigner.settings.marginTop": "Top (mm)",
    "documentDesigner.settings.metaAuthor": "Author",
    "documentDesigner.settings.metadata": "PDF metadata",
    "documentDesigner.settings.metaLanguage": "Language",
    "documentDesigner.settings.metaLanguageHint":
      "Follows the template language. Switch it with the language selector in the header.",
    "documentDesigner.settings.margins": "Margins in mm (top, right, bottom, left)",
    "documentDesigner.settings.metaTitle": "Title",
    "documentDesigner.settings.orientation": "Orientation",
    "documentDesigner.settings.page": "Document",
    "documentDesigner.settings.pageFormat": "Page format",
    "documentDesigner.settings.portrait": "Portrait",
    "documentDesigner.settings.printBackground": "Print backgrounds and colours",
    "documentDesigner.settings.storage": "Storage",
    "documentDesigner.settings.storageHint":
      "Every generated PDF carries the template id and version. Invoices stay verifiable even if the template changes later.",
    "documentDesigner.status.active": "Active",
    "documentDesigner.status.activeVersion": "Active v{version}",
    "documentDesigner.status.draft": "Draft",
    "documentDesigner.status.draftVersion": "Draft v{version}",
    "documentDesigner.validation.lastProbe": "Last test run: {pages} pages, {size}, {seconds} s",
    "documentDesigner.validation.missingRequired":
      'Required placeholder "{name}" is missing. Publishing is blocked.',
    "documentDesigner.validation.ok":
      "All required placeholders are present. After publishing, new PDFs use this version.",
  },
  de: {
    "documentDesigner.actions.generatePdf": "PDF erzeugen",
    "documentDesigner.canvas.caption":
      'Seite 1 · {format} · Die Vorschau zeigt Seitengrenzen nur ungefähr, verbindlich ist "PDF erzeugen".',
    "documentDesigner.canvas.fromLayout": "aus Layout „{layout}“",
    "documentDesigner.error.resourceTooLarge":
      "Das Bild ist zu groß. Bitte eine kleinere Datei wählen.",
    "documentDesigner.error.resourceUnsupportedImage":
      "Dieses Bildformat wird nicht unterstützt. Nutzen Sie PNG, JPEG, GIF oder WebP.",
    "documentDesigner.locale": "Sprache",
    "documentDesigner.localeDialog.cancel": "Abbrechen",
    "documentDesigner.localeDialog.description":
      "Die Änderungen in dieser Sprache sind noch nicht gespeichert.",
    "documentDesigner.localeDialog.discard": "Änderungen verwerfen",
    "documentDesigner.localeDialog.save": "Speichern und wechseln",
    "documentDesigner.localeDialog.title": "Ungespeicherte Änderungen",
    "documentDesigner.notFound": 'Die Vorlage "{slug}" wurde nicht gefunden.',
    "documentDesigner.originBar.export": "Als Bundle exportieren",
    "documentDesigner.originBar.noTotal":
      "System-Vorlage für alle Mandanten. {count} Mandanten haben eine eigene Fassung und bekommen Änderungen hier nicht.",
    "documentDesigner.originBar.withTotal":
      "System-Vorlage für alle Mandanten. {count} von {total} Mandanten haben eine eigene Fassung und bekommen Änderungen hier nicht.",
    "documentDesigner.originBar.showOverrides": "Anpassungen der Mandanten anzeigen",
    "documentDesigner.overrides.action.diff": "Unterschied anzeigen",
    "documentDesigner.overrides.action.open": "Öffnen",
    "documentDesigner.overrides.back": "Zurück zur Liste",
    "documentDesigner.overrides.column.changed": "Geändert",
    "documentDesigner.overrides.column.status": "Status",
    "documentDesigner.overrides.column.tenant": "Mandant",
    "documentDesigner.overrides.column.version": "Version",
    "documentDesigner.overrides.detail.version": "{tenant}, Version {version}",
    "documentDesigner.overrides.empty":
      "Kein Mandant hat diese Vorlage angepasst. Änderungen hier gelten für alle.",
    "documentDesigner.overrides.status.active": "Angepasst",
    "documentDesigner.overrides.status.draft": "Entwurf",
    "documentDesigner.overrides.summary": "{count} Mandanten haben eine eigene Fassung.",
    "documentDesigner.overrides.title": "Anpassungen der Mandanten",
    "documentDesigner.overrides.usedBy": "Wird verwendet von",
    "documentDesigner.overrides.usedByEmpty":
      "Keine registrierte Benachrichtigung nutzt diese Vorlage direkt.",
    "documentDesigner.pdfUnavailable": "PDF-Erzeugung nicht verfügbar: {message}",
    "documentDesigner.pdfUnavailableNoReason": "PDF-Erzeugung nicht verfügbar.",
    "documentDesigner.placeholders.layoutHint":
      'Bilder gehen im PDF als Data-URI mit. Kopf- und Fußzeile kommen aus dem Layout "{layout}" und sind auf allen Seiten gleich.',
    "documentDesigner.preview.loading": "PDF wird erzeugt ...",
    "documentDesigner.preview.pageOf": "Seite {page} von {pages}",
    "documentDesigner.preview.renderFailed": "Das PDF konnte nicht angezeigt werden.",
    "documentDesigner.preview.stale": "Die Vorschau ist veraltet. Bitte das PDF neu erzeugen.",
    "documentDesigner.resources.empty": "Noch keine Bilder.",
    "documentDesigner.resources.saveFirst":
      "Speichern Sie die Vorlage zuerst, danach können Bilder hochgeladen werden.",
    "documentDesigner.resources.title": "Ressourcen",
    "documentDesigner.resources.upload": "+ Hochladen",
    "documentDesigner.settings.fileName": "Dateiname",
    "documentDesigner.settings.landscape": "Querformat",
    "documentDesigner.settings.layout": "Layout",
    "documentDesigner.settings.layoutHeaderFooter": "Kopf- und Fußzeile aus Layout",
    "documentDesigner.settings.marginBottom": "Unten (mm)",
    "documentDesigner.settings.marginLeft": "Links (mm)",
    "documentDesigner.settings.marginRight": "Rechts (mm)",
    "documentDesigner.settings.marginTop": "Oben (mm)",
    "documentDesigner.settings.metaAuthor": "Autor",
    "documentDesigner.settings.metadata": "Metadaten im PDF",
    "documentDesigner.settings.metaLanguage": "Sprache",
    "documentDesigner.settings.metaLanguageHint":
      "Folgt der Sprache der Vorlage. Umstellen über die Sprachauswahl im Kopf.",
    "documentDesigner.settings.margins": "Ränder in mm (oben, rechts, unten, links)",
    "documentDesigner.settings.metaTitle": "Titel",
    "documentDesigner.settings.orientation": "Ausrichtung",
    "documentDesigner.settings.page": "Dokument",
    "documentDesigner.settings.pageFormat": "Seitenformat",
    "documentDesigner.settings.portrait": "Hochformat",
    "documentDesigner.settings.printBackground": "Hintergründe und Farben drucken",
    "documentDesigner.settings.storage": "Ablage",
    "documentDesigner.settings.storageHint":
      "Jedes erzeugte PDF trägt Vorlagen-Id und Version. Rechnungen bleiben so nachweisbar, auch wenn die Vorlage später geändert wird.",
    "documentDesigner.status.active": "Aktiv",
    "documentDesigner.status.activeVersion": "Aktiv v{version}",
    "documentDesigner.status.draft": "Entwurf",
    "documentDesigner.status.draftVersion": "Entwurf v{version}",
    "documentDesigner.validation.lastProbe":
      "Letzte Probe-Erzeugung: {pages} Seiten, {size}, {seconds} s",
    "documentDesigner.validation.missingRequired":
      'Pflicht-Platzhalter "{name}" fehlt. Veröffentlichen ist gesperrt.',
    "documentDesigner.validation.ok":
      "Alle Pflicht-Platzhalter vorhanden. Nach dem Veröffentlichen nutzen neue PDFs diese Fassung.",
  },
};
