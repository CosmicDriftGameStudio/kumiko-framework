// @runtime client
// Client-Feature-Factory für managed-pages. Bringt NUR die Übersetzungen mit —
// die Screens (page-list/page-edit/branding-settings) sind schema-driven
// (entityList/entityEdit/configEdit), also keine custom-React-Components zu
// registrieren. Apps mounten es in createKumikoApp({ clientFeatures:
// [managedPagesClient()] }), damit die Admin-Labels übersetzt rendern.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { defaultTranslations } from "./i18n";

export type ManagedPagesClientOptions = {
  /** Key-wise Overrides über die Default-Bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function managedPagesClient(options?: ManagedPagesClientOptions): ClientFeatureDefinition {
  return {
    name: "managed-pages",
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}
