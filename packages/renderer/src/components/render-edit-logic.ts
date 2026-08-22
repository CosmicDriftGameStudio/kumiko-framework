import type { EditSectionViewModel, SubmitResult } from "@cosmicdrift/kumiko-headless";

// Hides the Save button when no field is editable and no extension section
// contributes to the composed form submit. Extensions that persist via their
// own dispatcher writes must not opt in (fw#2359).
// Explicit-positive per kind (653/1), not `s.kind !== "fields"` — a future
// third EditSectionViewModel member would otherwise default to "editable"
// without anyone deciding that on purpose.
export function hasEditableSection(sections: readonly EditSectionViewModel[]): boolean {
  return sections.some(
    (s) =>
      (s.kind === "extension" && s.contributesToFormSubmit) ||
      (s.kind === "fields" && s.visible && s.fields.some((f) => !f.readOnly && f.visible)),
  );
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

// Extension and relatedList sections skip the `fields` filter (neither has a
// `field`-name set that filtering applies to); a `fields` section left with
// zero fields after filtering is dropped, not rendered empty.
export function filterEditSections(
  sections: readonly EditSectionViewModel[],
  fieldsFilter: readonly string[] | undefined,
): readonly EditSectionViewModel[] {
  if (fieldsFilter === undefined) return sections;
  const filterSet = new Set(fieldsFilter);
  const result: EditSectionViewModel[] = [];
  for (const section of sections) {
    if (section.kind === "extension" || section.kind === "relatedList") {
      result.push(section);
      continue;
    }
    const fields = section.fields.filter((f) => filterSet.has(f.field));
    if (fields.length === 0) continue;
    result.push({ ...section, fields });
  }
  return result;
}
