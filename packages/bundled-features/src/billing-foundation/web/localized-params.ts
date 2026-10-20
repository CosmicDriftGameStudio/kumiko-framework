export function localizedParams(
  params: Readonly<Record<string, string | number>> | undefined,
  locale: string,
): Readonly<Record<string, string>> | undefined {
  if (params === undefined) return undefined;
  const localized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    localized[key] =
      typeof value === "number" ? new Intl.NumberFormat(locale).format(value) : value;
  }
  return localized;
}
