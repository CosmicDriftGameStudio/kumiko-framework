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

// MoneyField/PercentField markieren die Feld-Absicht am Call-Site (lesbarer als
// NumberField überall) und sind der Ort, an dem später geld-/prozent-spezifische
// Formatierung andocken kann. Aktuell rendern sie identisch zu NumberField.
export function MoneyField(props: NumberFieldProps): ReactNode {
  return <NumberField {...props} />;
}

export function PercentField(props: NumberFieldProps): ReactNode {
  return <NumberField {...props} />;
}
