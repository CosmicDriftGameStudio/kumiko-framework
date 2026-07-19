import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export interface NumberFieldProps {
  readonly label: string;
  readonly id: string;
  readonly name: string;
  readonly value: number | undefined;
  readonly onChange: (v: number | undefined) => void;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
}

/** Zahlenfeld = Field + Input(kind:"number") in einem — nimmt der Screen die
 *  wiederholte id/name/value/onChange-Verdrahtung ab. `value` darf `undefined`
 *  sein (leeres Feld), intern auf den `""`-Empty-State des Inputs gemappt.
 *  Einheiten (€/%) gehören ins Label (`t("…Summe (€)")`), nicht als Badge. */
export function NumberField({
  label,
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  testId,
}: NumberFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} testId={testId}>
      <Input
        kind="number"
        id={id}
        name={name}
        value={value ?? ""}
        onChange={onChange}
        required={required}
        disabled={disabled}
      />
    </Field>
  );
}

// Aliase markieren die Feld-Absicht am Call-Site (lesbarer als NumberField
// überall) ohne eigene Wrapper-Funktion vorzutäuschen — beide sind identisch
// zu NumberField, kein Ort für künftige geld-/prozent-spezifische Formatierung.
export const MoneyField = NumberField;
export const PercentField = NumberField;

interface FieldBase {
  readonly label: string;
  readonly id: string;
  readonly name: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
}

export interface TextFieldProps extends FieldBase {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly autoComplete?: string;
}

/** Textfeld = Field + Input(kind:"text"). */
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
  testId,
}: TextFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} testId={testId}>
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

/** Auswahlfeld = Field + Input(kind:"select"). */
export function SelectField({
  label,
  id,
  name,
  value,
  onChange,
  options,
  required,
  disabled,
  testId,
}: SelectFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} testId={testId}>
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

/** Datumsfeld = Field + Input(kind:"date"), ISO yyyy-mm-dd. */
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
  testId,
}: DateFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} testId={testId}>
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
  testId,
}: BooleanFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} layout="inline" testId={testId}>
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
}

/** Mehrzeiliges Textfeld = Field + Input(kind:"textarea"). */
export function TextareaField({
  label,
  id,
  name,
  value,
  onChange,
  rows,
  required,
  disabled,
  testId,
}: TextareaFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} testId={testId}>
      <Input
        kind="textarea"
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        {...(rows !== undefined && { rows })}
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

/** Schieberegler = Field + Input(kind:"range"). */
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
  testId,
}: RangeFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} testId={testId}>
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
  /** FileRef-UUID der gespeicherten Datei, oder null. */
  readonly value: string | null;
  readonly onChange: (fileId: string | null) => void;
  readonly accept?: readonly string[];
  /** "image" zeigt eine Vorschau, "file" nur den Dateinamen. Default "file". */
  readonly variant?: "file" | "image";
  /** Bindet den Upload an ein konkretes Entity-Feld — der `/api/files`-Endpoint
   *  prüft `accept`/`maxSize` dann serverseitig gegen dessen Feld-Definition. */
  readonly entityType?: string;
  readonly fieldName?: string;
}

/** Datei-Upload = Field + Input(kind:"file"|"image") — FileRef-basiert. */
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
  testId,
}: FileFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label} required={required} testId={testId}>
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
