// Static catalog demo values — separators follow the active locale, unlike
// MoneyField/PercentField which bring their own formatters.
export function euro(n: number, locale: string): string {
  return `${n.toLocaleString(locale)} €`;
}

export function percent(n: number, locale: string): string {
  const formatted = n.toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return locale.startsWith("de") ? `${formatted} %` : `${formatted}%`;
}
