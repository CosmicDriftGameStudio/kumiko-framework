import { handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { TemplateResolverHandlers as H } from "./qualified-names.ts";

// The AI assistant and its approval prompts name a handler by its title key; without
// one the user reads the raw handler name. de/es/fr/it live in the locale packages.
export const TEMPLATE_RESOLVER_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [handlerTitleKey(H.upsertSystem)]: { en: "Save system template" },
  [handlerTitleKey(H.upsertTenant)]: { en: "Save template" },
  [handlerTitleKey(H.publish)]: { en: "Publish template" },
  [handlerTitleKey(H.archive)]: { en: "Archive template" },
  [handlerTitleKey(H.publishSystem)]: { en: "Publish system template" },
  [handlerTitleKey(H.archiveSystem)]: { en: "Archive system template" },
  [handlerTitleKey(H.discardDraft)]: { en: "Discard draft" },
  [handlerTitleKey(H.discardDraftSystem)]: { en: "Discard system template draft" },
  [handlerTitleKey(H.resetToSystem)]: { en: "Reset to system template" },
  [handlerTitleKey(H.set)]: { en: "Save text" },
  [handlerTitleKey(H.importBundle)]: { en: "Import template" },
  [handlerTitleKey(H.importBundleSystem)]: { en: "Import system template" },
  [handlerTitleKey(H.copyLocale)]: { en: "Copy template to another language" },
  [handlerTitleKey(H.resourceUpload)]: { en: "Upload image or attachment" },
  [handlerTitleKey(H.resourceRemove)]: { en: "Remove image or attachment" },
  [handlerTitleKey(H.resourceLinkPdf)]: { en: "Attach PDF template" },
  [handlerTitleKey(H.sendTest)]: { en: "Send test mail" },
  [handlerTitleKey(H.patchDraft)]: { en: "Edit template draft" },
};
