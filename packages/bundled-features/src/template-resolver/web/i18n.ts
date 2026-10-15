// @runtime client
// Default translation bundle for the text-block editor. textBlocksClient()
// hangs it into the LocaleProvider as a fallback bundle — apps override
// individual keys via mergeTranslations at the createKumikoApp level.
//
// Keys follow `template-resolver.editor.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "template-resolver.editor.titleLabel": "Title",
    "template-resolver.editor.contentLabel": "Content",
    "template-resolver.editor.save": "Save",
    "template-resolver.editor.saving": "Saving…",
    "template-resolver.editor.created": "Created.",
    "template-resolver.editor.saved": "Saved.",
    "templateResolver.errors.document.buttonHrefNotPlaceholder":
      "The button target “{detail}” must be a placeholder.",
    "templateResolver.errors.document.disallowedLinkHref":
      "Link target “{detail}” is not allowed; use https, http, mailto, tel or a placeholder.",
    "templateResolver.errors.document.documentRequiresHtmlFormat":
      "This template kind requires the html format, got “{detail}”.",
    "templateResolver.errors.document.eventHandlerAttribute":
      "Inline event handler “{detail}” is not allowed.",
    "templateResolver.errors.document.externalImageSource":
      "Images must reference an uploaded resource; image source “{detail}” is not allowed.",
    "templateResolver.errors.document.imageWithoutResource":
      "Images must reference an uploaded resource.",
    "templateResolver.errors.document.invalidReferenceName": "“{detail}” is not a valid name.",
    "templateResolver.errors.document.scriptElement":
      "<script> elements are not allowed in template bodies.",
    "template-resolver.editor.saveFailed": "Save failed.",
    "template-resolver.editor.networkError": "Network error while saving.",
    "template-resolver.editor.loading": "Loading current version…",
    "template-resolver.editor.loadFailed": "Could not load block",
    "template-resolver.editor.readOnly":
      "Read-only — TenantAdmin or SystemAdmin role required to make changes.",
  },
};
