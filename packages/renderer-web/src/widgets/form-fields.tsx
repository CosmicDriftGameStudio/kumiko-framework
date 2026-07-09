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
  /** Einheit rechts neben dem Label (z.B. "€", "%"). */
  readonly unit?: string;
  readonly testId?: string;
}

/** Zahlenfeld = Field + Input(kind:"number") in einem — nimmt der Screen die
 *  wiederholte id/name/value/onChange-Verdrahtung ab. `value` darf `undefined`
 *  sein (leeres Feld), intern auf den `""`-Empty-State des Inputs gemappt. */
export function NumberField({
  label,
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  unit,
  testId,
}: NumberFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field
      id={id}
      label={label}
      required={required}
      labelAppendix={
        unit !== undefined ? (
          <span className="text-xs text-muted-foreground">{unit}</span>
        ) : undefined
      }
      testId={testId}
    >
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

/** Euro-Betrag in ganzen Einheiten (kein Cent-Integer wie Input kind:"money").
 *  Preset über NumberField mit "€"-Einheit. */
export function MoneyField(props: Omit<NumberFieldProps, "unit">): ReactNode {
  return <NumberField {...props} unit="€" />;
}

/** Prozentwert (Zins, Tilgung, Rendite). Preset über NumberField mit "%". */
export function PercentField(props: Omit<NumberFieldProps, "unit">): ReactNode {
  return <NumberField {...props} unit="%" />;
}
