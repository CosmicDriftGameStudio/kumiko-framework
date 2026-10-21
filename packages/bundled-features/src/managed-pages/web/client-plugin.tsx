// Client feature factory for managed-pages. It provides ONLY translations —
// the screens (page-list/page-edit/branding-settings) are schema-driven
// (entityList/entityEdit/configEdit), so no custom React components are
// registered. Apps mount it in createKumikoApp({ clientFeatures:
// [managedPagesClient()] }) so the admin labels render translated.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { defaultTranslations } from "./default-translations.ts";

export type ManagedPagesClientOptions = {
  /** Key-wise overrides of the default bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function managedPagesClient(options?: ManagedPagesClientOptions): ClientFeatureDefinition {
  return {
    name: "managed-pages",
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}
