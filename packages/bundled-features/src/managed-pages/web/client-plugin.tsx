// Client feature factory for managed-pages: translations plus the page-body
// extension section (document editor) of the page-edit screen. The screens
// themselves are schema-driven. Apps mount it in createKumikoApp({ clientFeatures:
// [managedPagesClient()] }) so the admin labels render translated.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { PAGE_BODY_EXTENSION_NAME } from "./constants.ts";
import { defaultTranslations } from "./default-translations.ts";
import { PageBodySection } from "./page-body-section.tsx";

export type ManagedPagesClientOptions = {
  /** Key-wise overrides of the default bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function managedPagesClient(options?: ManagedPagesClientOptions): ClientFeatureDefinition {
  return {
    name: "managed-pages",
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    extensionSectionComponents: { [PAGE_BODY_EXTENSION_NAME]: PageBodySection },
  };
}
