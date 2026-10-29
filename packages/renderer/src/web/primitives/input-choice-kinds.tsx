import type { ReactNode } from "react";
import { Checkbox } from "../ui/checkbox.tsx";
import { Switch } from "../ui/switch.tsx";
import { ComboboxInput } from "./combobox.tsx";
import {
  RadioListSelect,
  SegmentedSelect,
  withInlineDisabledHint,
  withoutSegmentedSelectPlaceholder,
} from "./field.tsx";
import { stateProps } from "./input-optional-props.ts";
import { resolveSelectPresentation } from "./input-select-presentation.ts";
import type { KindRenderer, PropsOfKind } from "./input-shared.ts";

// layout="inline" (checkbox lists like MultiSelectCheckboxes, the
// BooleanField widget) keeps the checkbox optics; the standard form
// field (render-field.tsx, layout="stacked") gets the switch.
export const renderBooleanKind: KindRenderer<"boolean"> = (props, { booleanLayout }) =>
  booleanLayout === "inline" ? (
    <Checkbox
      id={props.id}
      name={props.name}
      disabled={props.disabled}
      aria-required={props.required}
      aria-invalid={props.hasError === true ? true : undefined}
      checked={props.value}
      onCheckedChange={(checked) => props.onChange(checked === true)}
    />
  ) : (
    <Switch
      id={props.id}
      name={props.name}
      disabled={props.disabled}
      aria-required={props.required}
      aria-invalid={props.hasError === true ? true : undefined}
      checked={props.value}
      onCheckedChange={(checked) => props.onChange(checked === true)}
      className="aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"
    />
  );

function normalizeSelectOptions(options: PropsOfKind<"select">["options"]) {
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

// Visual consolidation: all selects go through ComboboxInput
// (cmdk + Radix popover). Before, there were two paths: Radix
// Select for `kind:"select"` and cmdk for `kind:"combobox"`. Three
// visually different variants (single select, combobox single, combobox
// multi) became unmanageable. With the merge the combobox is the only
// implementation: the search input is present even for 4-item status
// selects, a deliberately accepted UX consequence for style consistency.
export const renderSelectKind: KindRenderer<"select"> = (props) => {
  const comboOptions = normalizeSelectOptions(props.options);
  // The radio group can't render the unselected placeholder as its own
  // segment, so it counts and renders on the real options only — the
  // dropdown below keeps comboOptions (placeholder included) since it
  // has a genuine "nothing selected" row.
  // An author who asks for `display: "radio"` explicitly declared the ""
  // option as a real choice (e.g. "Any"), so it stays a segment.
  const radioGroupOptions =
    props.display === "radio" ? comboOptions : withoutSegmentedSelectPlaceholder(comboOptions);
  const presentation = resolveSelectPresentation(props, radioGroupOptions);
  if (presentation === "radioList" && radioGroupOptions.length > 0) {
    return (
      <RadioListSelect
        id={props.id}
        name={props.name}
        value={props.value}
        onChange={props.onChange}
        options={radioGroupOptions}
        {...(props.radioVariant !== undefined && { variant: props.radioVariant })}
        {...stateProps(props)}
      />
    );
  }
  if (presentation === "segmented" && radioGroupOptions.length > 0) {
    return (
      <SegmentedSelect
        id={props.id}
        name={props.name}
        value={props.value}
        onChange={props.onChange}
        options={radioGroupOptions}
        {...(props.optionTones !== undefined && { tones: props.optionTones })}
        {...stateProps(props)}
      />
    );
  }
  // The dropdown shows a disabled option's hint inline, so it stays readable in the trigger and search.
  return (
    <ComboboxInput
      id={props.id}
      name={props.name}
      value={props.value}
      onChange={props.onChange}
      options={comboOptions.map(withInlineDisabledHint)}
      {...stateProps(props)}
    />
  );
};

function comboboxBaseProps(props: PropsOfKind<"combobox">) {
  return {
    id: props.id,
    name: props.name,
    options: props.options,
    ...stateProps(props),
    ...(props.placeholder !== undefined && { placeholder: props.placeholder }),
    ...(props.searchPlaceholder !== undefined && {
      searchPlaceholder: props.searchPlaceholder,
    }),
    ...(props.emptyText !== undefined && { emptyText: props.emptyText }),
    ...(props.onSearchChange !== undefined && { onSearchChange: props.onSearchChange }),
    ...(props.loading !== undefined && { loading: props.loading }),
    ...(props.onCreate !== undefined && { onCreate: props.onCreate }),
    ...(props.createLabel !== undefined && { createLabel: props.createLabel }),
  } as const;
}

// Discriminated union per `multiple`; we split
// TS-side into two branches so ComboboxInput's single/multi variants
// render with the right types.
export const renderComboboxKind: KindRenderer<"combobox"> = (props): ReactNode => {
  const baseProps = comboboxBaseProps(props);
  if (props.multiple === true) {
    return <ComboboxInput {...baseProps} multiple value={props.value} onChange={props.onChange} />;
  }
  return <ComboboxInput {...baseProps} value={props.value} onChange={props.onChange} />;
};
