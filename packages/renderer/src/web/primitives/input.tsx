import { type ChangeEvent, type KeyboardEvent, type ReactNode, useContext } from "react";
import type { InputProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { Checkbox } from "../ui/checkbox.tsx";
import { Input as UiInput } from "../ui/input.tsx";
import { Switch } from "../ui/switch.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { CodeInput } from "./code-input.tsx";
import { ComboboxInput } from "./combobox.tsx";
import { DateInput } from "./date-input.tsx";
import { FileUploadInput } from "./file-upload.tsx";
import { FilesDropzoneInput } from "./files-dropzone.tsx";
import { LocatedTimestampInput } from "./located-timestamp-input.tsx";
import { MoneyInput } from "./money-input.tsx";
import { NumberInput } from "./number-input.tsx";
import { hasDescriptionOrGroup } from "./option-groups.ts";
import { TimestampInput } from "./timestamp-input.tsx";
import { TzInput } from "./tz-input.tsx";
import { useFocusOnMount } from "./use-focus-on-mount.ts";
import "../react-css-custom-properties.ts";
import { FieldDescriptionContext, FieldLayoutContext } from "./contexts.tsx";
import {
  defaultSelectPresentation,
  FIELD_ICON_CLASS,
  fieldIconFor,
  RadioListSelect,
  SegmentedSelect,
  textareaMinHeight,
  unitSuffixId,
  withFieldIcon,
  withInlineDisabledHint,
  withInputAddons,
  withoutSegmentedSelectPlaceholder,
  withTrailingAction,
} from "./field.tsx";

export function DefaultInput(props: InputProps): ReactNode {
  // Vendored ui/input + ui/checkbox style errors via `aria-invalid`
  // themselves, no manual border-destructive needed anymore.
  const booleanLayout = useContext(FieldLayoutContext);
  const describedBy = useContext(FieldDescriptionContext);
  const textInputRef = useFocusOnMount(props.kind === "text" ? props.autoFocus : undefined);
  const common = {
    id: props.id,
    name: props.name,
    disabled: props.disabled,
    "aria-describedby": describedBy,
    "aria-required": props.required,
    "aria-invalid": props.hasError === true ? true : undefined,
  } as const;
  switch (props.kind) {
    case "text":
      return withInputAddons(
        props,
        withFieldIcon(
          props.icon,
          <UiInput
            type="text"
            ref={textInputRef}
            {...common}
            {...props.dataAttributes}
            data-testid={props.testId}
            readOnly={props.readOnly}
            value={props.value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
            onKeyDown={props.onKeyDown}
            {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
            {...(props.autoComplete !== undefined && { autoComplete: props.autoComplete })}
            className={cn(fieldIconFor(props.icon) !== undefined ? "pl-8" : undefined)}
          />,
        ),
      );
    case "code":
      return <CodeInput {...props} />;
    case "email":
      return (
        <UiInput
          type="email"
          {...common}
          data-testid={props.testId}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          autoComplete={props.autoComplete ?? "email"}
        />
      );
    case "month":
      return (
        <UiInput
          type="month"
          {...common}
          data-testid={props.testId}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
        />
      );
    case "password":
      return withTrailingAction(
        props.trailingAction,
        <UiInput
          type="password"
          {...common}
          data-testid={props.testId}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          autoComplete={props.autoComplete ?? "current-password"}
          className={props.trailingAction !== undefined ? "pr-9" : undefined}
        />,
        true,
      );
    case "number": {
      const NumberIcon = fieldIconFor(props.icon);
      // Icon, input and unit share this one box, and the grid cell sizes the
      // box rather than the bare input: anchored to a wider wrapper, the unit
      // would sit next to a narrower input instead of inside it.
      const numberField = (
        <div data-slot="number-field" className="relative">
          {NumberIcon !== undefined && (
            <NumberIcon aria-hidden="true" className={FIELD_ICON_CLASS} />
          )}
          <NumberInput
            id={props.id}
            name={props.name}
            value={props.value}
            onChange={props.onChange}
            disabled={props.disabled}
            required={props.required}
            hasError={props.hasError}
            testId={props.testId}
            {...(props.unit !== undefined && { ariaDescribedBy: unitSuffixId(props.id) })}
            {...(props.locale !== undefined && { locale: props.locale })}
            {...(props.grouping !== undefined && { grouping: props.grouping })}
            {...(props.integer !== undefined && { integer: props.integer })}
            {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
            className={cn(
              NumberIcon !== undefined ? "pl-8" : undefined,
              props.unit !== undefined ? "pr-8" : undefined,
            )}
          />
          {props.unit !== undefined && (
            <span
              id={unitSuffixId(props.id)}
              className="pointer-events-none absolute right-2.5 top-1/2 max-w-[40%] -translate-y-1/2 truncate text-sm text-muted-foreground"
            >
              {props.unit}
            </span>
          )}
        </div>
      );
      return withInputAddons(props, numberField);
    }
    case "range":
      return (
        <input
          type="range"
          {...common}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(Number(e.target.value))}
          className="w-full accent-primary"
        />
      );
    case "boolean":
      // layout="inline" (checkbox lists like MultiSelectCheckboxes, the
      // BooleanField widget) keeps the checkbox optics; the standard form
      // field (render-field.tsx, layout="stacked") gets the switch.
      return booleanLayout === "inline" ? (
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
    case "file":
    case "image":
      return (
        <FileUploadInput
          kind={props.kind}
          id={props.id}
          value={props.value}
          onChange={props.onChange}
          {...(props.accept !== undefined && { accept: props.accept })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.entityType !== undefined && { entityType: props.entityType })}
          {...(props.uploadActionForm !== undefined && {
            uploadActionForm: props.uploadActionForm,
          })}
          {...(props.entityId !== undefined && { entityId: props.entityId })}
          {...(props.fieldName !== undefined && { fieldName: props.fieldName })}
          {...(props.imageVariant !== undefined && { imageVariant: props.imageVariant })}
          {...(props.capture !== undefined && { capture: props.capture })}
          {...(props.directory !== undefined && { directory: props.directory })}
          {...(props.onFilesPicked !== undefined && { onFilesPicked: props.onFilesPicked })}
          {...(props.pickLabel !== undefined && { pickLabel: props.pickLabel })}
          {...(props.testId !== undefined && { testId: props.testId })}
        />
      );
    case "files-dropzone":
      return (
        <FilesDropzoneInput
          id={props.id}
          value={props.value}
          onChange={props.onChange}
          {...(props.accept !== undefined && { accept: props.accept })}
          {...(props.maxSize !== undefined && { maxSize: props.maxSize })}
          {...(props.maxCount !== undefined && { maxCount: props.maxCount })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.entityType !== undefined && { entityType: props.entityType })}
          {...(props.uploadActionForm !== undefined && {
            uploadActionForm: props.uploadActionForm,
          })}
          {...(props.entityId !== undefined && { entityId: props.entityId })}
          {...(props.fieldName !== undefined && { fieldName: props.fieldName })}
          {...(props.testId !== undefined && { testId: props.testId })}
        />
      );
    case "date":
      return (
        <DateInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.min !== undefined && { min: props.min })}
          {...(props.max !== undefined && { max: props.max })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "select": {
      // Visual consolidation: all selects go through ComboboxInput
      // (cmdk + Radix popover). Before, there were two paths: Radix
      // Select for `kind:"select"` and cmdk for `kind:"combobox"`. Three
      // visually different variants (single select, combobox single, combobox
      // multi) became unmanageable. With the merge the combobox is the only
      // implementation: the search input is present even for 4-item status
      // selects, a deliberately accepted UX consequence for style consistency.
      const comboOptions = props.options.map((o) =>
        typeof o === "string" ? { value: o, label: o } : o,
      );
      // The dropdown shows a disabled option's hint inline, so it stays readable in the trigger and search.
      const dropdownOptions = comboOptions.map(withInlineDisabledHint);
      // The radio group can't render the unselected placeholder as its own
      // segment, so it counts and renders on the real options only — the
      // dropdown below keeps comboOptions (placeholder included) since it
      // has a genuine "nothing selected" row.
      // An author who asks for `display: "radio"` explicitly declared the ""
      // option as a real choice (e.g. "Any"), so it stays a segment.
      const radioGroupOptions =
        props.display === "radio" ? comboOptions : withoutSegmentedSelectPlaceholder(comboOptions);
      // An explicit `display` is an author decision and outranks the
      // heuristic in both directions — a requested radio group renders as
      // one even when the options outnumber the heuristic's threshold.
      const requestedPresentation =
        props.radioVariant === "card"
          ? "radioList"
          : props.display === "radio"
            ? "segmented"
            : props.display === "dropdown"
              ? "dropdown"
              : defaultSelectPresentation(radioGroupOptions);
      // A segmented control has no room for a description line or group headings.
      const presentation =
        requestedPresentation === "segmented" && hasDescriptionOrGroup(radioGroupOptions)
          ? "radioList"
          : requestedPresentation;
      if (presentation === "radioList" && radioGroupOptions.length > 0) {
        return (
          <RadioListSelect
            id={props.id}
            name={props.name}
            value={props.value}
            onChange={props.onChange}
            options={radioGroupOptions}
            {...(props.radioVariant !== undefined && { variant: props.radioVariant })}
            {...(props.disabled !== undefined && { disabled: props.disabled })}
            {...(props.required !== undefined && { required: props.required })}
            {...(props.hasError !== undefined && { hasError: props.hasError })}
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
            {...(props.disabled !== undefined && { disabled: props.disabled })}
            {...(props.required !== undefined && { required: props.required })}
            {...(props.hasError !== undefined && { hasError: props.hasError })}
          />
        );
      }
      return (
        <ComboboxInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          options={dropdownOptions}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    }
    case "combobox": {
      // Discriminated union per `multiple`; we split
      // TS-side into two branches so ComboboxInput's single/multi variants
      // render with the right types.
      const baseProps = {
        id: props.id,
        name: props.name,
        options: props.options,
        ...(props.disabled !== undefined && { disabled: props.disabled }),
        ...(props.required !== undefined && { required: props.required }),
        ...(props.hasError !== undefined && { hasError: props.hasError }),
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
      if (props.multiple === true) {
        return (
          <ComboboxInput {...baseProps} multiple value={props.value} onChange={props.onChange} />
        );
      }
      return <ComboboxInput {...baseProps} value={props.value} onChange={props.onChange} />;
    }
    case "money":
      return (
        <MoneyInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          currency={props.currency ?? "EUR"}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "timestamp":
      return (
        <TimestampInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.wallClock !== undefined && { wallClock: props.wallClock })}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.min !== undefined && { min: props.min })}
          {...(props.max !== undefined && { max: props.max })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "locatedTimestamp":
      return (
        <LocatedTimestampInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.min !== undefined && { min: props.min })}
          {...(props.max !== undefined && { max: props.max })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "textarea": {
      const rows = props.rows;
      const onSubmitShortcut = props.onSubmitShortcut;
      const onKeyDown = props.onKeyDown;
      return (
        <Textarea
          {...common}
          {...props.dataAttributes}
          readOnly={props.readOnly}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => props.onChange(e.target.value)}
          rows={rows ?? 4}
          className="resize-y"
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          {...(rows !== undefined && { style: textareaMinHeight(rows) })}
          {...((onSubmitShortcut !== undefined || onKeyDown !== undefined) && {
            ...(onSubmitShortcut !== undefined && {
              "aria-keyshortcuts": "Control+Enter Meta+Enter",
            }),
            onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
              onKeyDown?.(e);
              // Lets a caller that already handles Ctrl/Cmd+Enter (e.g. an
              // "Enter sends" handler that ignores only Shift) opt out of the
              // shortcut instead of submitting twice.
              if (e.defaultPrevented) return;
              if (onSubmitShortcut === undefined || e.key !== "Enter" || !(e.metaKey || e.ctrlKey))
                return;
              e.preventDefault();
              onSubmitShortcut();
            },
          })}
        />
      );
    }
    case "tz":
      return (
        <TzInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
  }
}
