import type {
  DispatcherError,
  EditFieldViewModel,
  EditSectionViewModel,
  SubmitResult,
} from "@cosmicdrift/kumiko-headless";

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

// Embedded-list rows are dotted (e.g. `tasks.2.title`); the form field is the first segment.
export function issueRootField(path: string): string {
  return path.split(".")[0] ?? path;
}

// No issues at all counts as unmatched, so the caller keeps the banner.
export function hasIssueWithoutRenderedField(
  issuePaths: readonly string[],
  sections: readonly EditSectionViewModel[],
): boolean {
  const renderedFields = sections.flatMap((s) =>
    s.kind === "fields" && s.visible ? s.fields : [],
  );
  return hasIssueWithoutVisibleField(issuePaths, renderedFields);
}

export function hasIssueWithoutVisibleField(
  issuePaths: readonly string[],
  fields: readonly EditFieldViewModel[],
): boolean {
  if (issuePaths.length === 0) return true;
  const visibleFields = new Set(fields.filter((f) => f.visible).map((f) => f.field));
  return issuePaths.some((path) => !visibleFields.has(issueRootField(path)));
}

// Same visibility rule as hasIssueWithoutRenderedField: a hidden field shows
// no error, so jumping to its step would strand the user on an error-less step.
export function findFirstErroringSectionIndex(
  sections: readonly EditSectionViewModel[],
  issuePaths: readonly string[],
): number | undefined {
  const erroredFields = new Set(issuePaths.map(issueRootField));
  const index = sections.findIndex(
    (s) =>
      s.kind === "fields" &&
      s.visible &&
      s.fields.some((f) => f.visible && erroredFields.has(f.field)),
  );
  return index === -1 ? undefined : index;
}

// Extension, relatedList and writeForm sections skip the `fields` filter
// (writeForm's fields belong to its own independent form, not the host's);
// a `fields` section left with zero fields after filtering is dropped, not
// rendered empty.
export function filterEditSections(
  sections: readonly EditSectionViewModel[],
  fieldsFilter: readonly string[] | undefined,
): readonly EditSectionViewModel[] {
  if (fieldsFilter === undefined) return sections;
  const filterSet = new Set(fieldsFilter);
  const result: EditSectionViewModel[] = [];
  for (const section of sections) {
    if (
      section.kind === "extension" ||
      section.kind === "relatedList" ||
      section.kind === "writeForm"
    ) {
      result.push(section);
      continue;
    }
    const fields = section.fields.filter((f) => filterSet.has(f.field));
    if (fields.length === 0) continue;
    result.push({ ...section, fields });
  }
  return result;
}

// `onDelete` is typed `() => void`-compatible, so a caller can return any value
// at runtime (a WriteResult, `true`); only a real DispatcherError is a rejection.
export function isDispatcherRejection(value: unknown): value is DispatcherError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "i18nKey" in value &&
    typeof value.i18nKey === "string"
  );
}
