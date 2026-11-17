import { handlerTranslationKeys } from "@cosmicdrift/kumiko-framework/engine";

// The AI assistant and its approval prompts name a handler by its title key; without
// one the user reads the raw handler name. de/es live in the locale packages.
export const USER_DATA_RIGHTS_HANDLER_I18N = handlerTranslationKeys("user-data-rights", {
  writes: {
    "cancel-deletion": { title: { en: "Cancel account deletion" } },
    "lift-restriction": {
      title: { en: "Lift account restriction" },
      fields: { userId: { en: "User" } },
    },
    "request-deletion": { title: { en: "Request account deletion" } },
    "request-export": { title: { en: "Request data export" } },
    "restrict-account": {
      title: { en: "Restrict account" },
      fields: { userId: { en: "User" } },
    },
  },
});
