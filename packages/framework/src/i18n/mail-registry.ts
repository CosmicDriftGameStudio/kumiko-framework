const tables = new Map<string, Readonly<Record<string, string>>>();

export function registerMailTranslations(
  locale: string,
  bundle: Readonly<Record<string, string>>,
): void {
  const prev = tables.get(locale) ?? {};
  tables.set(locale, { ...prev, ...bundle });
}

export function hasMailTranslations(locale: string): boolean {
  const root = locale.split("-")[0] ?? locale;
  return tables.has(locale) || tables.has(root);
}

export function mailT(
  locale: string,
  key: string,
  params?: Readonly<Record<string, string>>,
): string {
  const root = locale.split("-")[0] ?? locale;
  const raw =
    tables.get(locale)?.[key] ?? tables.get(root)?.[key] ?? tables.get("en")?.[key] ?? key;
  if (params === undefined) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
}
