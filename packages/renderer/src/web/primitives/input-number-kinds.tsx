import type { ChangeEvent } from "react";
import { cn } from "../lib/cn.ts";
import { FIELD_ICON_CLASS, fieldIconFor, unitSuffixId, withInputAddons } from "./field.tsx";
import { stateProps } from "./input-optional-props.ts";
import type { KindRenderer } from "./input-shared.ts";
import { MoneyInput } from "./money-input.tsx";
import { NumberInput } from "./number-input.tsx";

export const renderNumberKind: KindRenderer<"number"> = (props) => {
  const NumberIcon = fieldIconFor(props.icon);
  // Icon, input and unit share this one box, and the grid cell sizes the
  // box rather than the bare input: anchored to a wider wrapper, the unit
  // would sit next to a narrower input instead of inside it.
  const numberField = (
    <div data-slot="number-field" className="relative">
      {NumberIcon !== undefined && <NumberIcon aria-hidden="true" className={FIELD_ICON_CLASS} />}
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
};

export const renderRangeKind: KindRenderer<"range"> = (props, { common }) => (
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

export const renderMoneyKind: KindRenderer<"money"> = (props) => (
  <MoneyInput
    id={props.id}
    name={props.name}
    value={props.value}
    onChange={props.onChange}
    currency={props.currency ?? "EUR"}
    {...(props.locale !== undefined && { locale: props.locale })}
    {...stateProps(props)}
  />
);
