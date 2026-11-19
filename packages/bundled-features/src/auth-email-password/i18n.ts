import { handlerTranslationKeys } from "@cosmicdrift/kumiko-framework/engine";

// The AI assistant and its approval prompts name a handler by its title key; without
// one the user reads the raw handler name. de/es live in the locale packages.
export const AUTH_EMAIL_PASSWORD_HANDLER_I18N = handlerTranslationKeys("auth-email-password", {
  writes: {
    logout: { title: { en: "Sign out" } },
  },
});
