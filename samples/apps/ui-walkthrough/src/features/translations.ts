import type { TranslationValue } from "@cosmicdrift/kumiko-framework/ui-types";
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

// r.translations() wants key-first ({key: {de, en}}); client bundles are locale-first.
export function toKeyFirst(
  translations: TranslationsByLocale,
): Record<string, { de: TranslationValue; en: TranslationValue }> {
  return Object.fromEntries(
    Object.keys(translations["de"] ?? {}).map((key) => [
      key,
      { de: translations["de"]?.[key] ?? "", en: translations["en"]?.[key] ?? "" },
    ]),
  );
}

export const openToAllSignedIn = (reason: string) =>
  ({ access: { openToAll: { reason } } }) as const;
