// Client feature factory for managed-pages: translations, the page-edit workbench screen and
// the "web" preview renderer (the template-resolver one, mounted here too because an app can run
// the page mask without `textBlocksClient`). Apps mount it in createKumikoApp({ clientFeatures:
// [managedPagesClient()] }) so the admin labels render translated.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { WebPreviewRenderer } from "../../template-resolver/web/index.ts";
import { PAGE_EDIT_SCREEN_ID } from "./constants.ts";
import { defaultTranslations } from "./default-translations.ts";
import { PageEditScreen } from "./page-edit-screen.tsx";

export type ManagedPagesClientOptions = {
  /** Key-wise overrides of the default bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function managedPagesClient(options?: ManagedPagesClientOptions): ClientFeatureDefinition {
  return {
    name: "managed-pages",
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    contentPreviews: { web: WebPreviewRenderer },
    components: { [PAGE_EDIT_SCREEN_ID]: PageEditScreen },
  };
}
