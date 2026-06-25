import type { EditSectionViewModel, SubmitResult } from "@cosmicdrift/kumiko-headless";

// A read-only inspector form — every field readOnly, no editable section — has
// nothing to submit, so the renderer drops the Save button rather than show a
// dead disabled one. An extension section carries its own dirty/save, so it
// counts as editable.
export function hasEditableSection(sections: readonly EditSectionViewModel[]): boolean {
  return sections.some((s) => s.kind !== "fields" || s.fields.some((f) => !f.readOnly));
}

// Single source of truth for the extension-section entity-id. The section mount
// and persistExtensions MUST resolve the same id — otherwise a section mounts
// editable against one id (vm.id) while the persist step writes to (or skips)
// another (null), silently dropping the user's input. An explicit `null` prop
// forces "no entity" (no extension persistence); an omitted prop (undefined)
// falls back to vm.id (= values["id"]), which the update form carries for the
// existing row, so editing custom fields on that row actually persists.
export function resolveExtensionEntityId(
  entityIdProp: string | null | undefined,
  vmId: string | null,
): string | null {
  return entityIdProp !== undefined ? entityIdProp : vmId;
}

// After a submit, decide whether to invoke the caller's onSubmit. The success
// callback typically navigates away, which unmounts the extension-error banner.
// Suppress the callback ONLY when the entity write succeeded but an extension-
// section persist failed: the user must stay on the form to see the banner and
// retry. Every other case still notifies the caller — entity failures and
// validation blocks carry information the caller needs.
export function shouldNotifyCaller(
  result: SubmitResult<unknown>,
  extensionsPersisted: boolean,
): boolean {
  return !(result.isSuccess && !extensionsPersisted);
}
