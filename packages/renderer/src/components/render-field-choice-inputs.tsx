import type { ReactNode } from "react";
import {
  AvailabilityOptionsMultiSelect,
  type SelectOptionEntry,
  staticSelectOptions,
} from "./availability-options-select.tsx";
import { FileListField } from "./file-list-field.tsx";
import { MultiSelectCheckboxes } from "./multi-select-checkboxes.tsx";
import type { RenderInputArgs, SharedInputProps } from "./render-field-input-shared.ts";
import { stringArrayOf, stringValue, withPinnedValues } from "./render-field-values.ts";

function renderMultiSelectControl(
  { field, id, Input, onChange }: RenderInputArgs,
  { common }: SharedInputProps,
  options: readonly SelectOptionEntry[],
  arrayValue: readonly string[],
): ReactNode {
  return field.display === "checkboxes" ? (
    <MultiSelectCheckboxes
      field={field}
      id={id}
      options={options}
      value={arrayValue}
      onChange={(v) => onChange(v)}
    />
  ) : (
    <Input
      kind="combobox"
      {...common}
      multiple
      value={arrayValue}
      onChange={(v) => onChange(withPinnedValues(v, options, arrayValue))}
      options={options}
    />
  );
}

export function renderMultiSelectInput(args: RenderInputArgs, shared: SharedInputProps): ReactNode {
  const { field } = args;
  const arrayValue = stringArrayOf(field.value);
  const renderControl = (options: readonly SelectOptionEntry[]): ReactNode =>
    renderMultiSelectControl(args, shared, options, arrayValue);
  if (field.selectOptionsAvailabilityQuery !== undefined && field.readOnly !== true) {
    return (
      <AvailabilityOptionsMultiSelect
        field={field}
        query={field.selectOptionsAvailabilityQuery.query}
        initialValues={arrayValue}
      >
        {renderControl}
      </AvailabilityOptionsMultiSelect>
    );
  }
  return renderControl(staticSelectOptions(field));
}

export function renderSelectInput(
  { field, Input, onChange }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  // Translated option labels come from the ViewModel builder
  // (computeEditViewModel, convention key
  // `<feature>:entity:<entity>:field:<field>:option:<value>`).
  // If no translations are registered, fall back to the raw value as the
  // label, which ComboboxInput then shows unchanged.
  const selectOptions =
    field.optionLabels !== undefined ? staticSelectOptions(field) : (field.options ?? []);
  // `display` is shared with multiSelect's "checkboxes", which is not a
  // select presentation — narrow to the two a select field can request.
  const display =
    field.display === "radio" || field.display === "dropdown" ? field.display : undefined;
  return (
    <Input
      kind="select"
      {...common}
      value={stringValue(field.value)}
      onChange={(v) => onChange(v)}
      options={selectOptions}
      {...(display !== undefined && { display })}
    />
  );
}

export function renderFileInput(
  { field, Input, onChange }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  const kind = field.type === "image" ? ("image" as const) : ("file" as const);
  const fileId = typeof field.value === "string" && field.value !== "" ? field.value : null;
  return (
    <Input
      kind={kind}
      {...common}
      value={fileId}
      onChange={(v) => onChange(v)}
      {...(field.accept !== undefined && { accept: field.accept })}
      {...(field.maxSize !== undefined && { maxSize: field.maxSize })}
      {...(field.entityType !== undefined && { entityType: field.entityType })}
      {...(field.uploadActionForm !== undefined && {
        uploadActionForm: field.uploadActionForm,
      })}
      {...(field.entityId !== undefined && { entityId: field.entityId })}
      {...(field.fieldName !== undefined && { fieldName: field.fieldName })}
      {...(field.imageVariant !== undefined && { imageVariant: field.imageVariant })}
      {...(field.capture !== undefined && { capture: field.capture })}
    />
  );
}

export function renderFileListInput({ field, id, hasError, onChange }: RenderInputArgs): ReactNode {
  return (
    <FileListField
      field={field}
      id={id}
      kind={field.type === "images" ? "image" : "file"}
      hasError={hasError}
      onChange={(ids) => onChange(ids)}
    />
  );
}

// embedded (without embeddedListCells — that's embeddedList, which has
// had its own EmbeddedListField widget) and jsonb carry
// arbitrary objects. Without a dedicated widget these must NOT fall
// through to a text input: stringValue() turns them into
// "[object Object]" and saving that overwrites the real data with the
// mangled string. A `required: true` on either is caught loudly
// at boot (validateNoWidgetRequiredField in the framework package)
// instead of silently failing here.
export function renderUnsupportedInput({
  field,
  id,
  Banner,
  Text,
  JsonView,
  t,
}: RenderInputArgs): ReactNode {
  const hasValue = field.value !== undefined && field.value !== null && field.value !== "";
  return (
    <Banner id={id} variant="info">
      {t("kumiko.field.unsupported")}
      {hasValue &&
        (JsonView !== undefined ? (
          <JsonView value={field.value} testId={`field-value-${field.field}`} />
        ) : (
          <Text variant="code">{JSON.stringify(field.value)}</Text>
        ))}
    </Banner>
  );
}
