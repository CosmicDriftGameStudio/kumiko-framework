import type { CapUnit } from "../types.ts";

const MB_PER_GB = 1024;
const MB_PER_TB = 1024 * 1024;

function megabyteUnit(valueInMb: number): { readonly unit: string; readonly divisor: number } {
  const magnitude = Math.abs(valueInMb);
  if (magnitude < MB_PER_GB) return { unit: "megabyte", divisor: 1 };
  if (magnitude < MB_PER_TB) return { unit: "gigabyte", divisor: MB_PER_GB };
  return { unit: "terabyte", divisor: MB_PER_TB };
}

export function formatCapAmount(value: number, unit: CapUnit | undefined, locale: string): string {
  try {
    if (unit === "mb") {
      const scaled = megabyteUnit(value);
      return new Intl.NumberFormat(locale, {
        style: "unit",
        unit: scaled.unit,
        unitDisplay: "short",
        maximumFractionDigits: 1,
      }).format(value / scaled.divisor);
    }
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

export function formatCapUsedOfLimit(
  used: number,
  limit: number,
  unit: CapUnit | undefined,
  locale: string,
): string {
  return `${formatCapAmount(used, unit, locale)} / ${formatCapAmount(limit, unit, locale)}`;
}
