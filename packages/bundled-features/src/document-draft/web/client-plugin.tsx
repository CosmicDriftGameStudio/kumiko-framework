import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { WebPreviewRenderer } from "../../template-resolver/web/index.ts";
import { DOCUMENT_DRAFT_EDITOR_SCREEN_ID, DOCUMENT_DRAFT_FEATURE } from "./constants.ts";
import { DocumentDraftEditorScreen } from "./editor-screen.tsx";
import { defaultTranslations } from "./i18n.ts";

export type DocumentDraftClientOptions = {
  /** Key-wise overrides of the default bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function documentDraftClient(options?: DocumentDraftClientOptions): ClientFeatureDefinition {
  return {
    name: DOCUMENT_DRAFT_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    contentPreviews: { web: WebPreviewRenderer },
    components: { [DOCUMENT_DRAFT_EDITOR_SCREEN_ID]: DocumentDraftEditorScreen },
  };
}
