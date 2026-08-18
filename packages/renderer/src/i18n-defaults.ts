// Framework default bundle. Strings the renderer components hard-require
// (save/cancel/delete buttons, empty states, search placeholder,
// nav-toggle aria-labels, validation reasons). createKumikoApp appends
// this as the very last fallback into the LocaleProvider — apps can
// override individual keys via clientFeatures.translations.
//
// Convention: all keys use the `kumiko.` prefix so they don't collide
// with app keys. Sub-paths group by area (actions / list / nav / form /
// validation).

import type { TranslationsByLocale } from "./i18n";

export const kumikoDefaultTranslations: TranslationsByLocale = {
  de: {
    // Actions — buttons in RenderEdit, RenderList, confirm dialogs.
    "kumiko.actions.save": "Speichern",
    "kumiko.actions.cancel": "Abbrechen",
    "kumiko.actions.delete": "Löschen",
    "kumiko.actions.delete-confirm": "Wirklich löschen?",
    "kumiko.actions.reload": "Neu laden",
    "kumiko.actions.create": "Neu",
    "kumiko.actions.edit": "Bearbeiten",
    "kumiko.actions.copyLink": "Link kopieren",
    "kumiko.actions.copyLinkCopied": "Kopiert!",
    "kumiko.actions.next": "Weiter",
    "kumiko.actions.back": "Zurück",
    "kumiko.actions.finish": "Abschließen",

    // Wizard step chrome (RenderEdit layout.mode="wizard").
    "kumiko.wizard.step": "Schritt {current} von {total}",
    "kumiko.wizard.step-with-title": "Schritt {current} von {total} · {title}",

    // Version — Update-Awareness-Banner (UpdateChecker).
    "kumiko.version.update-available": "Eine neue Version ist verfügbar.",

    // Toast — Self-service Docs-Link-Default (useToast docsLinkLabel).
    "kumiko.toast.learn-more": "Mehr erfahren",

    // Field — aria-labels for the Date/Timestamp primitives.
    "kumiko.field.open-calendar": "Kalender öffnen",
    "kumiko.field.dateField.placeholderYear": "J",
    "kumiko.field.dateField.placeholderMonth": "M",
    "kumiko.field.dateField.placeholderDay": "T",
    "kumiko.field.time": "Uhrzeit",
    "kumiko.field.timezone": "Zeitzone",
    "kumiko.field.locatedTzHint": "Zeit lokal am angegebenen Ort",
    "kumiko.field.reference-created-no-id":
      "Datensatz wurde angelegt, konnte aber nicht automatisch ausgewählt werden. Bitte manuell auswählen.",
    "kumiko.field.unsupported": "Dieser Feldtyp kann hier noch nicht bearbeitet werden.",
    "kumiko.field.embedded-list.add-row": "Zeile hinzufügen",
    "kumiko.field.embedded-list.remove-row": "Zeile entfernen",
    "kumiko.field.embedded-list.duplicate-row": "Zeile duplizieren",
    "kumiko.field.embedded-list.move-up": "Nach oben verschieben",
    "kumiko.field.embedded-list.move-down": "Nach unten verschieben",
    "kumiko.field.embedded-list.empty": "Noch keine Zeilen.",
    "kumiko.field.embedded-list.empty-cta": "Erste Zeile hinzufügen",
    "kumiko.field.embedded-list.paste-rows-truncated":
      "{count} eingefügte Zeile(n) wurden verworfen (maximale Zeilenzahl erreicht).",
    "kumiko.field.embedded-list.paste-cells-unmatched":
      "{count} Zelle(n) hatten keine passende Option und wurden nicht geändert.",

    // List — DataTable Toolbar, Empty-State, Search.
    "kumiko.list.search-placeholder": "Suchen…",
    "kumiko.list.empty.title": "Noch keine Einträge.",
    "kumiko.list.empty.hint": "Lege den ersten an, um loszulegen.",
    "kumiko.list.no-entries": "Keine Einträge.",
    "kumiko.list.end-of-list": "— Ende der Liste —",

    // Pager — status line + prev/next/page aria-labels (DataTable pagination="pages").
    "kumiko.pager.status": "{from}–{to} von {total}",
    "kumiko.pager.previousPage": "Vorherige Seite",
    "kumiko.pager.nextPage": "Nächste Seite",
    "kumiko.pager.page": "Seite {entry}",

    // Combobox — Tier 2.1c Searchable-Select.
    "kumiko.combobox.search-placeholder": "Suchen…",
    "kumiko.combobox.empty": "Keine Treffer.",
    "kumiko.combobox.loading": "Lade…",

    // Dashboard — default label for the "(all)" entry in the screen filter,
    // when DashboardFilterDefinition.allLabel isn't set.
    "kumiko.dashboard.filter.all": "Alle",
    "kumiko.combobox.placeholder": "—",

    // Widgets — Query-States (QueryTable, LoadingState, ErrorState).
    "kumiko.widget.loading": "Lade…",
    "kumiko.widget.error.title": "Konnte nicht geladen werden.",

    // Widgets — UploadZone status line per file.
    "kumiko.widget.upload.uploading": "Wird hochgeladen…",
    "kumiko.widget.upload.done": "Hochgeladen",
    "kumiko.widget.upload.error": "Fehlgeschlagen",
    "kumiko.widget.upload.rejected-type": "Dateityp nicht erlaubt",

    // Widgets — StepBar screen-reader text for completed steps whose number is visually replaced by a checkmark.
    "kumiko.widget.step-bar.done": "Erledigt",

    // Widgets — Drawer resize handle + maximize toggle aria-labels.
    "kumiko.widget.drawer.restore": "Drawer-Breite zurücksetzen",
    "kumiko.widget.drawer.maximize": "Drawer maximieren",
    "kumiko.widget.drawer.resize": "Drawer-Größe ändern",

    // Nav — Sidebar Tree (Toggle-aria-Labels).
    "kumiko.nav.expand": "Aufklappen",
    "kumiko.nav.collapse": "Zuklappen",
    "kumiko.nav.search": "Navigation durchsuchen…",
    "kumiko.nav.language": "Sprache",

    // Workspace — Switcher-Trigger aria-Label (renderer-web).
    "kumiko.workspace.switch": "Workspace wechseln",
    "kumiko.workspace.select": "Workspace wählen",

    // Dialog — Confirm-Buttons + Close-aria-Label.
    "kumiko.dialog.confirm": "Bestätigen",
    "kumiko.dialog.cancel": "Abbrechen",
    "kumiko.dialog.close": "Schließen",

    // AiTextField/AiTextArea — Ghost-Text-Hint, Toolbar-Aria-Labels, Diff-Dialog.
    "kumiko.aiText.acceptHint": "Tab = übernehmen, Esc = verwerfen",
    "kumiko.aiText.correct": "Korrigieren",
    "kumiko.aiText.translate": "Übersetzen",
    "kumiko.aiText.rewrite": "Umschreiben",
    "kumiko.aiText.diff.before": "Vorher",
    "kumiko.aiText.diff.after": "Nachher",
    "kumiko.aiText.diff.generating": "Wird generiert…",
    "kumiko.aiText.style.formal": "Formell",
    "kumiko.aiText.style.casual": "Locker",
    "kumiko.aiText.style.concise": "Kompakt",
    "kumiko.aiText.style.expand": "Ausführlicher",
    "kumiko.aiText.capExceeded": "Monatliches AI-Limit erreicht.",

    // Row-Actions — error toast when an action write fails.
    "kumiko.rowAction.failed": "Aktion fehlgeschlagen",

    // ContentEditor — variable chip bar (VariableChips).
    "kumiko.contentEditor.insertVariable": "{name} einfügen",
    "kumiko.contentEditor.preview": "Vorschau",
    "kumiko.contentEditor.editMode": "Bearbeiten",
    "kumiko.contentEditor.bold": "Fett",
    "kumiko.contentEditor.italic": "Kursiv",
    "kumiko.contentEditor.heading1": "Überschrift 1",
    "kumiko.contentEditor.heading2": "Überschrift 2",
    "kumiko.contentEditor.bulletList": "Aufzählungsliste",
    "kumiko.contentEditor.orderedList": "Nummerierte Liste",

    // Config-Cascade — Source-Badges + Cascade-Panel (ConfigCascadeView).
    "kumiko.config.source.user": "Mein Wert",
    "kumiko.config.source.tenant": "Tenant",
    "kumiko.config.source.system": "System",
    "kumiko.config.source.appOverride": "App-Override",
    "kumiko.config.source.computed": "Berechnet",
    "kumiko.config.source.default": "Standard",
    "kumiko.config.source.missing": "Fehlt",
    "kumiko.config.cascade.noValue": "Kein Wert gesetzt",
    "kumiko.config.cascade.activeMarker": "aktiv",
    "kumiko.config.cascade.resetTo": "Überschreibung zurücksetzen ({scope})",

    // Form — standard errors (app code can supply its own zod reasons,
    // these are the last safety layer).
    "kumiko.form.error.generic": "Etwas ist schiefgegangen.",
    "kumiko.form.error.version-conflict":
      "Datensatz wurde zwischenzeitlich geändert. Lade neu und versuche es erneut.",
    "kumiko.form.extension.save-failed": "Ein Zusatzfeld konnte nicht gespeichert werden.",
    "kumiko.form.draft.resume-multiple":
      "Mehrere offene Entwürfe für dieses Formular gefunden. Welchen möchtest du fortsetzen?",
    "kumiko.form.draft.resume-single":
      "Ein offener Entwurf für dieses Formular gefunden. Möchtest du ihn fortsetzen?",
    "kumiko.form.draft.start-new": "Neu beginnen",

    // Validation — default reason codes from the framework. App code can
    // inject its own via validation hooks; these are the generic ones.
    "kumiko.validation.required": "Pflichtfeld.",
    "kumiko.validation.invalid": "Ungültiger Wert.",
    "kumiko.validation.too-short": "Zu kurz (mindestens {min} Zeichen).",
    "kumiko.validation.too-long": "Zu lang (höchstens {max} Zeichen).",
    "kumiko.validation.out-of-range": "Wert außerhalb des erlaubten Bereichs.",

    // errors.validation.* — the canonical key namespace that server
    // (ValidationError) and client (zod-bridge) produce for field issues.
    // Codes = Zod 4 issue codes + framework-specific ones.
    "errors.validation.invalid_type": "Ungültiger Wert.",
    "errors.validation.too_small": "Zu klein oder zu kurz (Minimum: {minimum}).",
    "errors.validation.too_big": "Zu groß oder zu lang (Maximum: {maximum}).",
    "errors.validation.invalid_format": "Ungültiges Format.",
    "errors.validation.not_multiple_of": "Muss ein Vielfaches von {divisor} sein.",
    "errors.validation.unrecognized_keys": "Unbekannte Felder.",
    "errors.validation.invalid_union": "Ungültiger Wert.",
    "errors.validation.invalid_key": "Ungültiger Schlüssel.",
    "errors.validation.invalid_element": "Ungültiger Eintrag.",
    "errors.validation.invalid_value": "Ungültige Auswahl.",
    "errors.validation.custom": "Ungültiger Wert.",
    "errors.validation.unexpected_field": "Unbekanntes Feld.",
    "errors.validation.out_of_bounds": "Wert außerhalb des erlaubten Bereichs.",
    "errors.validation.invalid_option": "Ungültige Auswahl.",
    "errors.validation.failed": "Validierung fehlgeschlagen.",

    // errors.* — top-level error codes (one per httpStatus class). Last
    // fallback when an app doesn't supply its own translation; deliberately
    // generic (no technical entity/feature/key names shown to end users —
    // those live in `details` for devs). Apps override per key.
    "errors.feature.disabled": "Diese Funktion ist derzeit nicht verfügbar.",
    "errors.access.denied": "Dazu hast du keine Berechtigung.",
    "errors.notFound": "Nicht gefunden.",
    "errors.conflict": "Konflikt — der Vorgang konnte nicht abgeschlossen werden.",
    "errors.versionConflict":
      "Der Datensatz wurde zwischenzeitlich geändert. Lade neu und versuche es erneut.",
    "errors.uniqueViolation": "Dieser Eintrag existiert bereits.",
    "errors.unprocessable": "Die Anfrage konnte nicht verarbeitet werden.",
    "errors.unconfigured": "Diese Funktion ist noch nicht konfiguriert.",
    "errors.internal": "Etwas ist schiefgegangen. Bitte versuche es später erneut.",
    "errors.rate_limited": "Zu viele Anfragen. Bitte versuche es in Kürze erneut.",
    "errors.cap.exceeded":
      "Limit erreicht. Bitte Tarif upgraden oder auf die nächste Periode warten.",
    "errors.download.urlMissing": "Download nicht verfügbar — bitte versuche es erneut.",
    "auth.errors.originNotAllowed": "Zugriff von dieser Herkunft ist nicht erlaubt.",
    "dispatcher.errors.network":
      "Netzwerkfehler. Bitte überprüfe deine Verbindung und versuche es erneut.",
    "dispatcher.errors.aborted": "Anfrage abgebrochen.",
  },
  en: {
    "kumiko.actions.save": "Save",
    "kumiko.actions.cancel": "Cancel",
    "kumiko.actions.delete": "Delete",
    "kumiko.actions.delete-confirm": "Confirm delete?",
    "kumiko.actions.reload": "Reload",
    "kumiko.actions.create": "New",
    "kumiko.actions.edit": "Edit",
    "kumiko.actions.copyLink": "Copy link",
    "kumiko.actions.copyLinkCopied": "Copied!",
    "kumiko.actions.next": "Next",
    "kumiko.actions.back": "Back",
    "kumiko.actions.finish": "Finish",

    "kumiko.wizard.step": "Step {current} of {total}",
    "kumiko.wizard.step-with-title": "Step {current} of {total} · {title}",

    "kumiko.version.update-available": "A new version is available.",

    "kumiko.toast.learn-more": "Learn more",

    "kumiko.field.open-calendar": "Open calendar",
    "kumiko.field.dateField.placeholderYear": "Y",
    "kumiko.field.dateField.placeholderMonth": "M",
    "kumiko.field.dateField.placeholderDay": "D",
    "kumiko.field.time": "Time",
    "kumiko.field.timezone": "Time zone",
    "kumiko.field.locatedTzHint": "Time local to the given location",
    "kumiko.field.reference-created-no-id":
      "Record was created but could not be selected automatically. Please select it manually.",
    "kumiko.field.unsupported": "This field type can't be edited here yet.",
    "kumiko.field.embedded-list.add-row": "Add row",
    "kumiko.field.embedded-list.remove-row": "Remove row",
    "kumiko.field.embedded-list.duplicate-row": "Duplicate row",
    "kumiko.field.embedded-list.move-up": "Move up",
    "kumiko.field.embedded-list.move-down": "Move down",
    "kumiko.field.embedded-list.empty": "No rows yet.",
    "kumiko.field.embedded-list.empty-cta": "Add first row",
    "kumiko.field.embedded-list.paste-rows-truncated":
      "{count} pasted row(s) were dropped (max row count reached).",
    "kumiko.field.embedded-list.paste-cells-unmatched":
      "{count} cell(s) had no matching option and were left unchanged.",

    "kumiko.list.search-placeholder": "Search…",
    "kumiko.list.empty.title": "No entries yet.",
    "kumiko.list.empty.hint": "Create the first one to get started.",
    "kumiko.list.no-entries": "No entries.",
    "kumiko.list.end-of-list": "— End of list —",

    "kumiko.pager.status": "{from}–{to} of {total}",
    "kumiko.pager.previousPage": "Previous page",
    "kumiko.pager.nextPage": "Next page",
    "kumiko.pager.page": "Page {entry}",

    "kumiko.combobox.search-placeholder": "Search…",
    "kumiko.combobox.empty": "No matches.",
    "kumiko.combobox.loading": "Loading…",
    "kumiko.combobox.placeholder": "—",

    "kumiko.dashboard.filter.all": "All",

    "kumiko.widget.loading": "Loading…",
    "kumiko.widget.error.title": "Couldn't load.",

    "kumiko.widget.upload.uploading": "Uploading…",
    "kumiko.widget.upload.done": "Uploaded",
    "kumiko.widget.upload.error": "Failed",
    "kumiko.widget.upload.rejected-type": "File type not allowed",

    "kumiko.widget.step-bar.done": "Done",

    "kumiko.widget.drawer.restore": "Restore drawer width",
    "kumiko.widget.drawer.maximize": "Maximize drawer width",
    "kumiko.widget.drawer.resize": "Resize drawer",

    "kumiko.nav.expand": "Expand",
    "kumiko.nav.collapse": "Collapse",
    "kumiko.nav.search": "Search navigation…",
    "kumiko.nav.language": "Language",

    "kumiko.workspace.switch": "Switch workspace",
    // Workspace-Switcher fallback label when activeId points at no visible workspace.
    "kumiko.workspace.select": "Select workspace",

    "kumiko.dialog.confirm": "Confirm",
    "kumiko.dialog.cancel": "Cancel",
    "kumiko.dialog.close": "Close",

    "kumiko.aiText.acceptHint": "Tab = accept, Esc = discard",
    "kumiko.aiText.correct": "Correct",
    "kumiko.aiText.translate": "Translate",
    "kumiko.aiText.rewrite": "Rewrite",
    "kumiko.aiText.diff.before": "Before",
    "kumiko.aiText.diff.after": "After",
    "kumiko.aiText.diff.generating": "Generating…",
    "kumiko.aiText.style.formal": "Formal",
    "kumiko.aiText.style.casual": "Casual",
    "kumiko.aiText.style.concise": "Concise",
    "kumiko.aiText.style.expand": "Expand",
    "kumiko.aiText.capExceeded": "Monthly AI limit reached.",

    "kumiko.rowAction.failed": "Action failed",

    "kumiko.contentEditor.insertVariable": "Insert {name}",
    "kumiko.contentEditor.preview": "Preview",
    "kumiko.contentEditor.editMode": "Edit",
    "kumiko.contentEditor.bold": "Bold",
    "kumiko.contentEditor.italic": "Italic",
    "kumiko.contentEditor.heading1": "Heading 1",
    "kumiko.contentEditor.heading2": "Heading 2",
    "kumiko.contentEditor.bulletList": "Bullet list",
    "kumiko.contentEditor.orderedList": "Numbered list",

    "kumiko.config.source.user": "My value",
    "kumiko.config.source.tenant": "Tenant",
    "kumiko.config.source.system": "System",
    "kumiko.config.source.appOverride": "App override",
    "kumiko.config.source.computed": "Computed",
    "kumiko.config.source.default": "Default",
    "kumiko.config.source.missing": "Missing",
    "kumiko.config.cascade.noValue": "No value set",
    "kumiko.config.cascade.activeMarker": "active",
    "kumiko.config.cascade.resetTo": "Reset override ({scope})",

    "kumiko.form.error.generic": "Something went wrong.",
    "kumiko.form.error.version-conflict":
      "Record was modified in the meantime. Reload and try again.",
    "kumiko.form.extension.save-failed": "A custom field could not be saved.",
    "kumiko.form.draft.resume-multiple":
      "Found multiple open drafts for this form. Which one do you want to resume?",
    "kumiko.form.draft.resume-single":
      "Found an open draft for this form. Do you want to resume it?",
    "kumiko.form.draft.start-new": "Start new",

    "kumiko.validation.required": "Required.",
    "kumiko.validation.invalid": "Invalid value.",
    "kumiko.validation.too-short": "Too short (at least {min} characters).",
    "kumiko.validation.too-long": "Too long (at most {max} characters).",
    "kumiko.validation.out-of-range": "Value out of allowed range.",

    "errors.validation.invalid_type": "Invalid value.",
    "errors.validation.too_small": "Too small or too short (minimum: {minimum}).",
    "errors.validation.too_big": "Too big or too long (maximum: {maximum}).",
    "errors.validation.invalid_format": "Invalid format.",
    "errors.validation.not_multiple_of": "Must be a multiple of {divisor}.",
    "errors.validation.unrecognized_keys": "Unknown fields.",
    "errors.validation.invalid_union": "Invalid value.",
    "errors.validation.invalid_key": "Invalid key.",
    "errors.validation.invalid_element": "Invalid entry.",
    "errors.validation.invalid_value": "Invalid choice.",
    "errors.validation.custom": "Invalid value.",
    "errors.validation.unexpected_field": "Unknown field.",
    "errors.validation.out_of_bounds": "Value out of allowed range.",
    "errors.validation.invalid_option": "Invalid choice.",
    "errors.validation.failed": "Validation failed.",

    "errors.feature.disabled": "This feature is currently unavailable.",
    "errors.access.denied": "You don't have permission to do this.",
    "errors.notFound": "Not found.",
    "errors.conflict": "Conflict — the operation could not be completed.",
    "errors.versionConflict": "The record was modified in the meantime. Reload and try again.",
    "errors.uniqueViolation": "This entry already exists.",
    "errors.unprocessable": "The request could not be processed.",
    "errors.unconfigured": "This feature isn't configured yet.",
    "errors.internal": "Something went wrong. Please try again later.",
    "errors.rate_limited": "Too many requests. Please try again shortly.",
    "errors.cap.exceeded": "Limit reached. Upgrade your plan or wait for the next period.",
    "errors.download.urlMissing": "Download unavailable — please try again.",
    "auth.errors.originNotAllowed": "Requests from this origin are not allowed.",
    "dispatcher.errors.network": "Network error. Please check your connection and try again.",
    "dispatcher.errors.aborted": "Request was cancelled.",
  },
  es: {
    // Actions — buttons in RenderEdit, RenderList, confirm dialogs.
    "kumiko.actions.save": "Guardar",
    "kumiko.actions.cancel": "Cancelar",
    "kumiko.actions.delete": "Eliminar",
    "kumiko.actions.delete-confirm": "¿Seguro que quieres eliminar?",
    "kumiko.actions.reload": "Recargar",
    "kumiko.actions.create": "Nuevo",
    "kumiko.actions.edit": "Editar",
    "kumiko.actions.copyLink": "Copiar enlace",
    "kumiko.actions.copyLinkCopied": "¡Copiado!",
    "kumiko.actions.next": "Siguiente",
    "kumiko.actions.back": "Atrás",
    "kumiko.actions.finish": "Finalizar",

    // Wizard step chrome (RenderEdit layout.mode="wizard").
    "kumiko.wizard.step": "Paso {current} de {total}",
    "kumiko.wizard.step-with-title": "Paso {current} de {total} · {title}",

    // Version — Update-Awareness-Banner (UpdateChecker).
    "kumiko.version.update-available": "Hay una nueva versión disponible.",

    // Toast — Self-service Docs-Link-Default (useToast docsLinkLabel).
    "kumiko.toast.learn-more": "Más información",

    // Field — aria-labels for the Date/Timestamp primitives.
    "kumiko.field.open-calendar": "Abrir calendario",
    "kumiko.field.dateField.placeholderYear": "A",
    "kumiko.field.dateField.placeholderMonth": "M",
    "kumiko.field.dateField.placeholderDay": "D",
    "kumiko.field.time": "Hora",
    "kumiko.field.timezone": "Zona horaria",
    "kumiko.field.locatedTzHint": "Hora local del lugar indicado",
    "kumiko.field.reference-created-no-id":
      "El registro se creó pero no se pudo seleccionar automáticamente. Selecciónalo manualmente.",
    "kumiko.field.unsupported": "Este tipo de campo todavía no se puede editar aquí.",
    "kumiko.field.embedded-list.add-row": "Añadir fila",
    "kumiko.field.embedded-list.remove-row": "Quitar fila",
    "kumiko.field.embedded-list.duplicate-row": "Duplicar fila",
    "kumiko.field.embedded-list.move-up": "Mover arriba",
    "kumiko.field.embedded-list.move-down": "Mover abajo",
    "kumiko.field.embedded-list.empty": "Todavía no hay filas.",
    "kumiko.field.embedded-list.empty-cta": "Añadir la primera fila",
    "kumiko.field.embedded-list.paste-rows-truncated":
      "Se descartaron {count} fila(s) pegadas (se alcanzó el número máximo de filas).",
    "kumiko.field.embedded-list.paste-cells-unmatched":
      "{count} celda(s) no tenían una opción coincidente y no se modificaron.",

    // List — DataTable Toolbar, Empty-State, Search.
    "kumiko.list.search-placeholder": "Buscar…",
    "kumiko.list.empty.title": "Todavía no hay entradas.",
    "kumiko.list.empty.hint": "Crea la primera para empezar.",
    "kumiko.list.no-entries": "Sin entradas.",
    "kumiko.list.end-of-list": "— Fin de la lista —",

    // Pager — status line + prev/next/page aria-labels (DataTable pagination="pages").
    "kumiko.pager.status": "{from}–{to} de {total}",
    "kumiko.pager.previousPage": "Página anterior",
    "kumiko.pager.nextPage": "Página siguiente",
    "kumiko.pager.page": "Página {entry}",

    // Combobox — Tier 2.1c Searchable-Select.
    "kumiko.combobox.search-placeholder": "Buscar…",
    "kumiko.combobox.empty": "Sin resultados.",
    "kumiko.combobox.loading": "Cargando…",

    // Dashboard — default label for the "(all)" entry in the screen filter,
    // when DashboardFilterDefinition.allLabel isn't set.
    "kumiko.dashboard.filter.all": "Todos",
    "kumiko.combobox.placeholder": "—",

    // Widgets — Query-States (QueryTable, LoadingState, ErrorState).
    "kumiko.widget.loading": "Cargando…",
    "kumiko.widget.error.title": "No se pudo cargar.",

    // Widgets — UploadZone status line per file.
    "kumiko.widget.upload.uploading": "Subiendo…",
    "kumiko.widget.upload.done": "Subido",
    "kumiko.widget.upload.error": "Fallido",
    "kumiko.widget.upload.rejected-type": "Tipo de archivo no permitido",

    // Widgets — StepBar screen-reader text for completed steps whose number is visually replaced by a checkmark.
    "kumiko.widget.step-bar.done": "Hecho",

    // Widgets — Drawer resize handle + maximize toggle aria-labels.
    "kumiko.widget.drawer.restore": "Restablecer ancho del panel",
    "kumiko.widget.drawer.maximize": "Maximizar panel",
    "kumiko.widget.drawer.resize": "Cambiar tamaño del panel",

    // Nav — Sidebar Tree (Toggle-aria-Labels).
    "kumiko.nav.expand": "Expandir",
    "kumiko.nav.collapse": "Contraer",
    "kumiko.nav.search": "Buscar en la navegación…",
    "kumiko.nav.language": "Idioma",

    // Workspace — Switcher-Trigger aria-Label (renderer-web).
    "kumiko.workspace.switch": "Cambiar de espacio de trabajo",
    "kumiko.workspace.select": "Selecciona un espacio de trabajo",

    // Dialog — Confirm-Buttons + Close-aria-Label.
    "kumiko.dialog.confirm": "Confirmar",
    "kumiko.dialog.cancel": "Cancelar",
    "kumiko.dialog.close": "Cerrar",

    // AiTextField/AiTextArea — Ghost-Text-Hint, Toolbar-Aria-Labels, Diff-Dialog.
    "kumiko.aiText.acceptHint": "Tab = aceptar, Esc = descartar",
    "kumiko.aiText.correct": "Corregir",
    "kumiko.aiText.translate": "Traducir",
    "kumiko.aiText.rewrite": "Reescribir",
    "kumiko.aiText.diff.before": "Antes",
    "kumiko.aiText.diff.after": "Después",
    "kumiko.aiText.diff.generating": "Generando…",
    "kumiko.aiText.style.formal": "Formal",
    "kumiko.aiText.style.casual": "Informal",
    "kumiko.aiText.style.concise": "Conciso",
    "kumiko.aiText.style.expand": "Ampliar",
    "kumiko.aiText.capExceeded": "Se alcanzó el límite mensual de IA.",

    // Row-Actions — error toast when an action write fails.
    "kumiko.rowAction.failed": "La acción falló",

    // ContentEditor — variable chip bar (VariableChips).
    "kumiko.contentEditor.insertVariable": "Insertar {name}",
    "kumiko.contentEditor.preview": "Vista previa",
    "kumiko.contentEditor.editMode": "Editar",
    "kumiko.contentEditor.bold": "Negrita",
    "kumiko.contentEditor.italic": "Cursiva",
    "kumiko.contentEditor.heading1": "Encabezado 1",
    "kumiko.contentEditor.heading2": "Encabezado 2",
    "kumiko.contentEditor.bulletList": "Lista con viñetas",
    "kumiko.contentEditor.orderedList": "Lista numerada",

    // Config-Cascade — Source-Badges + Cascade-Panel (ConfigCascadeView).
    "kumiko.config.source.user": "Mi valor",
    "kumiko.config.source.tenant": "Tenant",
    "kumiko.config.source.system": "Sistema",
    "kumiko.config.source.appOverride": "Anulación de la app",
    "kumiko.config.source.computed": "Calculado",
    "kumiko.config.source.default": "Predeterminado",
    "kumiko.config.source.missing": "Falta",
    "kumiko.config.cascade.noValue": "Sin valor establecido",
    "kumiko.config.cascade.activeMarker": "activo",
    "kumiko.config.cascade.resetTo": "Restablecer anulación ({scope})",

    // Form — standard errors (app code can supply its own zod reasons,
    // these are the last safety layer).
    "kumiko.form.error.generic": "Algo salió mal.",
    "kumiko.form.error.version-conflict":
      "El registro se modificó mientras tanto. Recarga e inténtalo de nuevo.",
    "kumiko.form.extension.save-failed": "No se pudo guardar un campo adicional.",
    "kumiko.form.draft.resume-multiple":
      "Se encontraron varios borradores abiertos para este formulario. ¿Cuál quieres continuar?",
    "kumiko.form.draft.resume-single":
      "Se encontró un borrador abierto para este formulario. ¿Quieres continuarlo?",
    "kumiko.form.draft.start-new": "Empezar de nuevo",

    // Validation — default reason codes from the framework. App code can
    // inject its own via validation hooks; these are the generic ones.
    "kumiko.validation.required": "Campo obligatorio.",
    "kumiko.validation.invalid": "Valor no válido.",
    "kumiko.validation.too-short": "Demasiado corto (mínimo {min} caracteres).",
    "kumiko.validation.too-long": "Demasiado largo (máximo {max} caracteres).",
    "kumiko.validation.out-of-range": "Valor fuera del rango permitido.",

    // errors.validation.* — the canonical key namespace that server
    // (ValidationError) and client (zod-bridge) produce for field issues.
    // Codes = Zod 4 issue codes + framework-specific ones.
    "errors.validation.invalid_type": "Valor no válido.",
    "errors.validation.too_small": "Demasiado pequeño o demasiado corto (mínimo: {minimum}).",
    "errors.validation.too_big": "Demasiado grande o demasiado largo (máximo: {maximum}).",
    "errors.validation.invalid_format": "Formato no válido.",
    "errors.validation.not_multiple_of": "Debe ser un múltiplo de {divisor}.",
    "errors.validation.unrecognized_keys": "Campos desconocidos.",
    "errors.validation.invalid_union": "Valor no válido.",
    "errors.validation.invalid_key": "Clave no válida.",
    "errors.validation.invalid_element": "Entrada no válida.",
    "errors.validation.invalid_value": "Selección no válida.",
    "errors.validation.custom": "Valor no válido.",
    "errors.validation.unexpected_field": "Campo desconocido.",
    "errors.validation.out_of_bounds": "Valor fuera del rango permitido.",
    "errors.validation.invalid_option": "Selección no válida.",
    "errors.validation.failed": "Validación fallida.",

    // errors.* — top-level error codes (one per httpStatus class). Last
    // fallback when an app doesn't supply its own translation; deliberately
    // generic (no technical entity/feature/key names shown to end users —
    // those live in `details` for devs). Apps override per key.
    "errors.feature.disabled": "Esta función no está disponible actualmente.",
    "errors.access.denied": "No tienes permiso para hacer esto.",
    "errors.notFound": "No encontrado.",
    "errors.conflict": "Conflicto — no se pudo completar la operación.",
    "errors.versionConflict":
      "El registro se modificó mientras tanto. Recarga e inténtalo de nuevo.",
    "errors.uniqueViolation": "Esta entrada ya existe.",
    "errors.unprocessable": "No se pudo procesar la solicitud.",
    "errors.unconfigured": "Esta función todavía no está configurada.",
    "errors.internal": "Algo salió mal. Inténtalo de nuevo más tarde.",
    "errors.rate_limited": "Demasiadas solicitudes. Inténtalo de nuevo en breve.",
    "errors.cap.exceeded": "Límite alcanzado. Mejora tu plan o espera al siguiente período.",
    "errors.download.urlMissing": "Descarga no disponible — inténtalo de nuevo.",
    "auth.errors.originNotAllowed": "No se permiten solicitudes desde este origen.",
    "dispatcher.errors.network": "Error de red. Comprueba tu conexión e inténtalo de nuevo.",
    "dispatcher.errors.aborted": "Solicitud cancelada.",
  },
};
