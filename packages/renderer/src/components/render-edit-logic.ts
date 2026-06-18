import type { SubmitResult } from "@cosmicdrift/kumiko-headless";

// Single source of truth for the extension-section entity-id. The section
// mount and persistExtensions MUST resolve the same id — otherwise a section
// can mount editable against one id while the persist step writes to (or skips)
// another, silently dropping the user's input. We deliberately do NOT fall back
// to `vm.id` (values["id"]): id is not a declared form field, so in the update
// form vm.id is always missing, and in create mode there is no entity to write
// to yet. Omitting `entityId` therefore means "no extension persistence",
// matching the prop contract in RenderEditProps.
export function resolveExtensionEntityId(entityIdProp: string | null | undefined): string | null {
  return entityIdProp ?? null;
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
