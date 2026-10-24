export type I18nOptions = {
  defaultLocale: string;
};

export type I18n = {
  t(key: string, locale?: string, params?: Readonly<Record<string, unknown>>): string;
  getAllKeys(): string[];
};
