import type { Translate } from "@cosmicdrift/kumiko-renderer/headless";

// Placeholders the renderer fills in; only the ones that are not plain text are listed.
export const SYSTEM_PLACEHOLDER_TYPE: Readonly<Partial<Record<string, "link">>> = {
  imprint: "link",
  unsubscribeUrl: "link",
};

// t() returns the key itself without a translation.
export function translatedOr(t: Translate, key: string, fallback: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

export function systemPlaceholderLabel(t: Translate, name: string): string {
  return translatedOr(t, `template-resolver.systemPlaceholder.${name}`, name);
}
