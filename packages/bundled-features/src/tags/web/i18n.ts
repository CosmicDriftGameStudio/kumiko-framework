// @runtime client
// Default translation bundle for the tags UI. tagsClient() hangs it into the
// LocaleProvider as a fallback bundle — apps override individual keys via
// tagsClient({ translations: { de: { ... } } }). Keys follow `tags.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "tags.section.createMode": "Speichere zuerst den Eintrag, um Tags zu setzen.",
    "tags.section.loading": "Lädt…",
    "tags.section.empty": "Keine Tags gefunden.",
    "tags.section.working": "Speichert…",
    "tags.section.none": "Keine Tags",
    "tags.section.edit": "Tags bearbeiten",
    "tags.manage.newLabel": "Neuer Tag",
    "tags.manage.namePlaceholder": "Tag-Name",
    "tags.manage.scopeLabel": "Geltungsbereich (Entity-Typ, leer = global)",
    "tags.manage.scopePlaceholder": "z. B. note (leer = überall)",
    "tags.manage.create": "Tag anlegen",
    "tags.manage.edit": "Bearbeiten",
    "tags.manage.save": "Speichern",
    "tags.manage.cancel": "Abbrechen",
    "tags.manage.delete": "Löschen",
    "tags.manage.toggle": "Tag umschalten",
    "tags.manage.usage": "{count}×",
    "tags.manage.deleteConfirmTitle": "Tag „{name}“ löschen?",
    "tags.manage.deleteConfirmDesc":
      "Entfernt ihn von {count} Objekten. Das lässt sich nicht rückgängig machen.",
    "tags.picker.title": "Tags",
    "tags.picker.done": "Fertig",
    "tags.filter.label": "Nach Tag filtern",
    "tags.filter.active": "Tags: {count}",
  },
  en: {
    "tags.section.createMode": "Save the entity first to add tags.",
    "tags.section.loading": "Loading…",
    "tags.section.empty": "No tags found.",
    "tags.section.working": "Saving…",
    "tags.section.none": "No tags",
    "tags.section.edit": "Edit tags",
    "tags.manage.newLabel": "New label",
    "tags.manage.namePlaceholder": "Label name",
    "tags.manage.scopeLabel": "Scope (entity type, empty = global)",
    "tags.manage.scopePlaceholder": "e.g. note (empty = everywhere)",
    "tags.manage.create": "Create label",
    "tags.manage.edit": "Edit",
    "tags.manage.save": "Save",
    "tags.manage.cancel": "Cancel",
    "tags.manage.delete": "Delete",
    "tags.manage.toggle": "Toggle label",
    "tags.manage.usage": "{count}×",
    "tags.manage.deleteConfirmTitle": "Delete label “{name}”?",
    "tags.manage.deleteConfirmDesc": "Removes it from {count} objects. This can't be undone.",
    "tags.picker.title": "Tags",
    "tags.picker.done": "Done",
    "tags.filter.label": "Filter by tag",
    "tags.filter.active": "Tags: {count}",
  },
};
