const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

// Falls back to the raw value for an unparseable timestamp, like formatWhen.
export function formatRelativeWhen(value: string, now: number = Date.now()): string {
  const then = Date.parse(value);
  if (Number.isNaN(then)) return value;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const elapsed = then - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) return formatter.format(Math.round(elapsed / size), unit);
  }
  return formatter.format(0, "minute");
}
