import { handlerTranslationKeys } from "@cosmicdrift/kumiko-framework/engine";

// The AI assistant and its approval prompts name a handler by its title key; without
// one the user reads the raw handler name. de/es live in the locale packages.
export const MANAGED_PAGES_HANDLER_I18N = handlerTranslationKeys("managed-pages", {
  writes: {
    set: {
      title: { en: "Save page" },
      fields: {
        slug: { en: "URL path" },
        lang: { en: "Language" },
        title: { en: "Title" },
        body: { en: "Content" },
        bodyFormat: { en: "Content format" },
        description: { en: "Description" },
        ogImage: { en: "Preview image" },
        published: { en: "Published" },
        tenantIdOverride: { en: "Target tenant" },
      },
    },
  },
});
