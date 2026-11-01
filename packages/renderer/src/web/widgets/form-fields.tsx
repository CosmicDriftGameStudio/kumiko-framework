import type { ReactNode } from "react";
import { usePrimitives } from "../../index.ts";

export interface NumberFieldProps {
  readonly label: string;
  readonly id: string;
  readonly name: string;
  readonly value: number | undefined;
  readonly onChange: (v: number | undefined) => void;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly hideLabel?: boolean;
  readonly testId?: string;
  /** `false` renders without thousands separators (e.g. a year). Default `true`. */
  readonly grouping?: boolean;
}

/** Number field = Field + Input(kind:"number"); avoids repeating the
 *  id/name/value/onChange wiring at each screen. `value` may be `undefined`
 *  (empty field) and is mapped internally to the Input's `""` empty state.
 *  Units (€/%) belong in the label (`t("…Summe (€)")`), not in a badge. */
export function NumberField({
  label,
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  hideLabel,
  testId,
  grouping,
}: NumberFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} hideLabel={hideLabel} testId={testId}>
      <Input
        kind="number"
        id={id}
        name={name}
        value={value ?? ""}
        onChange={onChange}
        required={required}
        disabled={disabled}
        {...(grouping !== undefined && { grouping })}
      />
    </Field>
  );
}

// Aliases convey the field's intent at the call site (more readable than
// using NumberField everywhere) without pretending to be wrapper functions;
// both are identical to NumberField and are not intended for future
// money-/percentage-specific formatting.
export const MoneyField = NumberField;
export const PercentField = NumberField;

interface FieldBase {
  readonly label: string;
  readonly id: string;
  readonly name: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly hideLabel?: boolean;
  readonly testId?: string;
}

export interface TextFieldProps extends FieldBase {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly autoComplete?: string;
}

/** Text field = Field + Input(kind:"text"). */
export function TextField({
  label,
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  autoComplete,
  hideLabel,
  testId,
}: TextFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} hideLabel={hideLabel} testId={testId}>
      <Input
        kind="text"
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        {...(placeholder !== undefined && { placeholder })}
        {...(autoComplete !== undefined && { autoComplete })}
      />
    </Field>
  );
}

export interface SelectFieldProps extends FieldBase {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly options:
    | readonly string[]
    | readonly { readonly value: string; readonly label: string }[];
}

/** Select field = Field + Input(kind:"select"). */
export function SelectField({
  label,
  id,
  name,
  value,
  onChange,
  options,
  required,
  disabled,
  hideLabel,
  testId,
}: SelectFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} hideLabel={hideLabel} testId={testId}>
      <Input
        kind="select"
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        options={options}
        required={required}
        disabled={disabled}
      />
    </Field>
  );
}

export interface DateFieldProps extends FieldBase {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly min?: string;
  readonly max?: string;
}

/** Date field = Field + Input(kind:"date"), ISO yyyy-mm-dd. */
export function DateField({
  label,
  id,
  name,
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  hideLabel,
  testId,
}: DateFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} hideLabel={hideLabel} testId={testId}>
      <Input
        kind="date"
        id={id}
        name={name}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        required={required}
        disabled={disabled}
        {...(min !== undefined && { min })}
        {...(max !== undefined && { max })}
      />
    </Field>
  );
}

export interface BooleanFieldProps extends FieldBase {
  readonly value: boolean;
  readonly onChange: (v: boolean) => void;
}

/** Checkbox/Switch = Field(layout:"inline") + Input(kind:"boolean"). */
export function BooleanField({
  label,
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  hideLabel,
  testId,
}: BooleanFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field
      id={id}
      label={label}
      required={required}
      layout="inline"
      hideLabel={hideLabel}
      testId={testId}
    >
      <Input
        kind="boolean"
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
      />
    </Field>
  );
}

export interface TextareaFieldProps extends FieldBase {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly rows?: number;
  readonly placeholder?: string;
}

/** Multi-line text field = Field + Input(kind:"textarea"). */
export function TextareaField({
  label,
  id,
  name,
  value,
  onChange,
  rows,
  placeholder,
  required,
  disabled,
  hideLabel,
  testId,
}: TextareaFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} hideLabel={hideLabel} testId={testId}>
      <Input
        kind="textarea"
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        {...(rows !== undefined && { rows })}
        {...(placeholder !== undefined && { placeholder })}
      />
    </Field>
  );
}

export interface RangeFieldProps extends FieldBase {
  readonly value: number;
  readonly onChange: (v: number) => void;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
}

/** Slider = Field + Input(kind:"range"). */
export function RangeField({
  label,
  id,
  name,
  value,
  onChange,
  min,
  max,
  step,
  required,
  disabled,
  hideLabel,
  testId,
}: RangeFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} hideLabel={hideLabel} testId={testId}>
      <Input
        kind="range"
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        {...(step !== undefined && { step })}
      />
    </Field>
  );
}

export interface FileFieldProps extends FieldBase {
  /** FileRef UUID of the stored file, or null. */
  readonly value: string | null;
  readonly onChange: (fileId: string | null) => void;
  readonly accept?: readonly string[];
  /** "image" shows a preview; "file" shows only the file name. Default "file". */
  readonly variant?: "file" | "image";
  /** Binds the upload to a specific entity field; the `/api/files` endpoint
   *  then validates `accept`/`maxSize` server-side against that field's definition. */
  readonly entityType?: string;
  readonly fieldName?: string;
}

/** File upload = Field + Input(kind:"file"|"image"), based on FileRef. */
export function FileField({
  label,
  id,
  name,
  value,
  onChange,
  accept,
  variant = "file",
  entityType,
  fieldName,
  required,
  disabled,
  hideLabel,
  testId,
}: FileFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} hideLabel={hideLabel} testId={testId}>
      <Input
        kind={variant}
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        {...(accept !== undefined && { accept })}
        {...(entityType !== undefined && { entityType })}
        {...(fieldName !== undefined && { fieldName })}
      />
    </Field>
  );
}
