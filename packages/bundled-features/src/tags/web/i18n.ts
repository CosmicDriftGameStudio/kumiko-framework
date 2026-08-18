// @runtime client
// Default translation bundle for the tags UI. tagsClient() hangs it into the
// LocaleProvider as a fallback bundle — apps override individual keys via
// tagsClient({ translations: { de: { ... } } }). Keys follow `tags.<area>.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
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
    "tags.filter.clear": "Clear",
  },
};
