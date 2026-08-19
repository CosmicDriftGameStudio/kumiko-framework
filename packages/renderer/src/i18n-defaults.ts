// Framework-Default-Bundle. Strings die die Renderer-Components hart
// brauchen (Save/Cancel/Delete-Buttons, Empty-States, Search-Placeholder,
// Nav-Toggle-aria-Labels, Validation-Reasons). createKumikoApp hängt das
// als ALLERLETZTEN Fallback in den LocaleProvider — Apps können
// einzelne Keys via clientFeatures.translations überschreiben.
//
// Convention: alle Keys mit `kumiko.`-Prefix damit sie nicht mit
// App-Keys kollidieren. Sub-Pfade gruppieren nach Bereich (actions /
// list / nav / form / validation).

import type { TranslationsByLocale } from "./i18n";

export const kumikoDefaultTranslations: TranslationsByLocale = {
  en: {
    "kumiko.actions.save": "Save",
    "kumiko.actions.cancel": "Cancel",
    "kumiko.actions.delete": "Delete",
    "kumiko.actions.delete-confirm": "Confirm delete?",
    "kumiko.actions.reload": "Reload",
    "kumiko.actions.create": "New",
    "kumiko.actions.edit": "Edit",
    "kumiko.actions.view": "View",
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
};
