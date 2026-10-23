import {
  applyFormatSpec,
  currencyDecimals,
  type EditFieldViewModel,
  EMPTY_VALUE_PLACEHOLDER,
} from "../headless/index.ts";
import {
  locatedValue,
  moneyMinorValue,
  numberValue,
  resolveMoneyCurrency,
  stringValue,
} from "./render-field-values.ts";

export type DisplayText = (field: EditFieldViewModel, value: unknown, appLocale: string) => string;

const booleanText: DisplayText = (_field, value) => applyFormatSpec({ format: "boolean" }, value);

const dateText: DisplayText = (field, value, appLocale) =>
  applyFormatSpec({ format: "date", locale: field.dateLocale ?? appLocale }, value);

const timestampText: DisplayText = (field, value, appLocale) =>
  applyFormatSpec({ format: "timestamp", locale: field.dateLocale ?? appLocale }, value);

const locatedTimestampText: DisplayText = (field, value, appLocale) => {
  const located = locatedValue(value);
  if (located === "" || located.at === "") return EMPTY_VALUE_PLACEHOLDER;
  return timestampText(field, located.utc ?? located.at, appLocale);
};

const numberText: DisplayText = (field, value, appLocale) => {
  const n = numberValue(value);
  return n === ""
    ? EMPTY_VALUE_PLACEHOLDER
    : new Intl.NumberFormat(appLocale, { useGrouping: field.grouping ?? true }).format(n);
};

const moneyText: DisplayText = (field, value, appLocale) => {
  const currency = resolveMoneyCurrency(value, field.currency);
  const minor = moneyMinorValue(value, currency);
  if (minor === "") return EMPTY_VALUE_PLACEHOLDER;
  const major = minor / 10 ** currencyDecimals(currency);
  return new Intl.NumberFormat(appLocale, { style: "currency", currency }).format(major);
};

const selectText: DisplayText = (field, value) => {
  const labels = field.optionLabels;
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) return EMPTY_VALUE_PLACEHOLDER;
  return values
    .map((v) => (typeof v === "string" ? (labels?.[v] ?? v) : stringValue(v)))
    .join(", ");
};

// A Map (not an object) so prototype keys like "constructor" never match.
export const DISPLAY_TEXT_BY_TYPE: ReadonlyMap<string, DisplayText> = new Map([
  ["boolean", booleanText],
  ["date", dateText],
  ["timestamp", timestampText],
  ["locatedTimestamp", locatedTimestampText],
  ["number", numberText],
  ["bigInt", numberText],
  ["decimal", numberText],
  ["money", moneyText],
  ["select", selectText],
  ["multiSelect", selectText],
]);

export const defaultDisplayText: DisplayText = (_field, value) => stringValue(value);
