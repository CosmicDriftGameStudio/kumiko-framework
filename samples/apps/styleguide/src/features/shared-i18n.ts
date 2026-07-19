export type LocalizedString = { readonly de: string; readonly en: string };

// Derives the client { en, de } shape from the same map a feature registers
// server-side (r.translations) — one source instead of two kept in sync by hand.
export function toClientTranslations(map: Readonly<Record<string, LocalizedString>>): {
  en: Record<string, string>;
  de: Record<string, string>;
} {
  const en: Record<string, string> = {};
  const de: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    en[key] = value.en;
    de[key] = value.de;
  }
  return { en, de };
}
