import type { ReactNode } from "react";
import type { RenderInputArgs, SharedInputProps } from "./render-field-input-shared.ts";
import { resolveFieldIcon } from "./render-field-meta.ts";
import {
  locatedValue,
  moneyMinorValue,
  moneyPayload,
  numberValue,
  resolveMoneyCurrency,
  resolveNumberUnit,
  stringValue,
} from "./render-field-values.ts";

// decimal/bigInt are both plain numbers on the wire (fieldToZod:
// z.number() / z.number().int().safe()) — the number input's onChange
// already emits `number | undefined`, so no extra coercion is needed
// beyond what "number" already does.
export function renderNumberInput(
  { field, Input, onChange, appLocale, row }: RenderInputArgs,
  { common, placeholderProp, affixProps }: SharedInputProps,
): ReactNode {
  const icon = resolveFieldIcon(field);
  const unit = resolveNumberUnit(field.unit, row);
  return (
    <Input
      kind="number"
      {...common}
      value={numberValue(field.value)}
      onChange={(v) => onChange(v)}
      locale={appLocale}
      {...(field.grouping !== undefined && { grouping: field.grouping })}
      {...(field.type === "bigInt" && { integer: true })}
      {...placeholderProp}
      {...affixProps}
      {...(icon !== undefined && { icon })}
      {...(unit !== undefined && { unit })}
    />
  );
}

export function renderDecimalInput(
  { field, Input, onChange, appLocale }: RenderInputArgs,
  { common, placeholderProp, affixProps }: SharedInputProps,
): ReactNode {
  const icon = resolveFieldIcon(field);
  return (
    <Input
      kind="number"
      {...common}
      value={numberValue(field.value)}
      onChange={(v) => onChange(v)}
      locale={appLocale}
      {...(field.grouping !== undefined && { grouping: field.grouping })}
      {...placeholderProp}
      {...affixProps}
      {...(icon !== undefined && { icon })}
    />
  );
}

export function renderTzInput(
  { field, Input, onChange }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  return (
    <Input kind="tz" {...common} value={stringValue(field.value)} onChange={(v) => onChange(v)} />
  );
}

export function renderMoneyInput(
  { field, Input, onChange, appLocale }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  const currency = resolveMoneyCurrency(field.value, field.currency);
  return (
    <Input
      kind="money"
      {...common}
      value={moneyMinorValue(field.value, currency)}
      onChange={(v) => onChange(moneyPayload(v, currency))}
      currency={currency}
      locale={appLocale}
    />
  );
}

export function renderBooleanInput(
  { field, Input, onChange }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  return (
    <Input kind="boolean" {...common} value={field.value === true} onChange={(v) => onChange(v)} />
  );
}

export function renderDateInput(
  { field, Input, onChange, appLocale }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  return (
    <Input
      kind="date"
      {...common}
      value={stringValue(field.value)}
      onChange={(v) => onChange(v)}
      locale={field.dateLocale ?? appLocale}
      {...(field.min !== undefined && { min: field.min })}
      {...(field.max !== undefined && { max: field.max })}
    />
  );
}

export function renderTimestampInput(
  { field, Input, onChange, appLocale }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  return (
    <Input
      kind="timestamp"
      {...common}
      value={stringValue(field.value)}
      onChange={(v) => onChange(v)}
      locale={field.dateLocale ?? appLocale}
      {...(field.wallClock !== undefined && { wallClock: field.wallClock })}
      {...(field.min !== undefined && { min: field.min })}
      {...(field.max !== undefined && { max: field.max })}
    />
  );
}

export function renderLocatedTimestampInput(
  { field, Input, onChange, appLocale }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  return (
    <Input
      kind="locatedTimestamp"
      {...common}
      value={locatedValue(field.value)}
      onChange={(v) => onChange(v)}
      locale={field.dateLocale ?? appLocale}
      {...(field.min !== undefined && { min: field.min })}
      {...(field.max !== undefined && { max: field.max })}
    />
  );
}
