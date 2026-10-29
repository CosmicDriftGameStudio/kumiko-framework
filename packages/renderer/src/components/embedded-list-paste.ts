import { currencyDecimals } from "../headless/index.ts";
import type { EmbeddedListColumn } from "../primitives.tsx";

// Locale-aware decimal parse for pasted text: strips space/NBSP thousands
// separators outright, then treats whichever of "," or "." appears LAST in
// the string as the decimal separator and strips the other one — handles
// both "1.234,56" (de) and "1,234.56" (en-US) pastes. Returns undefined for
// anything that still doesn't parse as a finite number.
function parseLocaleAwareDecimal(raw: string): number | undefined {
  const stripped = raw.replace(/[\s\u00a0]/g, "");
  if (stripped === "") return undefined;
  const lastComma = stripped.lastIndexOf(",");
  const lastDot = stripped.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  if (decimalIndex === -1) {
    const n = Number(stripped);
    return Number.isFinite(n) ? n : undefined;
  }
  const integerPart = stripped.slice(0, decimalIndex).replace(/[.,]/g, "");
  const fractionPart = stripped.slice(decimalIndex + 1);
  if (!/^\d*$/.test(integerPart) || !/^\d*$/.test(fractionPart)) return undefined;
  const n = Number(
    `${integerPart === "" ? "0" : integerPart}.${fractionPart === "" ? "0" : fractionPart}`,
  );
  return Number.isFinite(n) ? n : undefined;
}

function coerceNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

// Money cells are minor-unit integers (cents) in storage — paste arrives as a major-unit decimal
// string ("12,99"/"12.99"), so scale by the currency's decimal places. Must agree with the
// typed-in path (MoneyInput, which scales by the same currencyDecimals) — a hardcoded ×100
// diverged for zero-/three-decimal currencies (JPY, BHD, ...).
function coerceMoney(text: string, currency: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = parseLocaleAwareDecimal(text);
  return n === undefined ? undefined : Math.round(n * 10 ** currencyDecimals(currency));
}

function coerceSelect(column: EmbeddedListColumn, text: string): string | undefined {
  return (column.options ?? []).find((opt) => opt === text || column.optionLabels?.[opt] === text);
}

function coerceReference(column: EmbeddedListColumn, text: string): string | undefined {
  return (column.referenceOptions ?? []).find((o) => o.label === text || o.value === text)?.value;
}

export function coerceCellValue(
  column: EmbeddedListColumn,
  text: string,
  currency: string,
): unknown {
  switch (column.type) {
    case "text":
      return text;
    case "number":
    case "decimal":
      return coerceNumber(text);
    case "money":
      return coerceMoney(text, currency);
    case "boolean":
      return ["true", "1", "yes", "y", "ja"].includes(text.trim().toLowerCase());
    case "date":
    case "timestamp":
      return text.trim();
    case "select":
      return coerceSelect(column, text);
    case "reference":
      return coerceReference(column, text);
    case "images":
    case "files":
      return undefined;
    default: {
      const exhaustiveCheck: never = column.type;
      return exhaustiveCheck;
    }
  }
}
