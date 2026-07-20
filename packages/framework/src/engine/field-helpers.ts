import type { AnyFileFieldDef, FieldDefinition } from "./types/fields";

// --- Currency ---

export const DEFAULT_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "CAD",
  "AUD",
  "NZD",
  "CNY",
  "INR",
] as const;

export function isFileField(field: FieldDefinition | undefined): field is AnyFileFieldDef {
  if (!field) return false;
  return (
    field.type === "file" ||
    field.type === "image" ||
    field.type === "files" ||
    field.type === "images"
  );
}
