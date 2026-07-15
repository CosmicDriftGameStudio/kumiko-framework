export type LocalizedString = { readonly de: string; readonly en: string };

// Ein Feature registriert seine i18n-Keys serverseitig (r.translations, für
// den Boot-Validator + SSR-Fallback) UND clientseitig (ClientFeatureDefinition.
// translations, für den Renderer). toClientTranslations() leitet die
// Client-Form { en, de } aus derselben LocalizedString-Map ab, damit beide
// Seiten aus EINER Quelle laufen statt zwei manuell synchron zu haltenden.
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
