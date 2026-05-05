// i18n Sample
// Shows: r.translations() for multi-language feature keys

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const greetingFeature = defineFeature("greeting", (r) => {
  r.translations({
    keys: {
      "greeting.welcome": {
        de: "Willkommen",
        en: "Welcome",
        fr: "Bienvenue",
      },
      "greeting.goodbye": {
        de: "Auf Wiedersehen",
        en: "Goodbye",
        fr: "Au revoir",
      },
      "greeting.hello_name": {
        de: "Hallo, {name}!",
        en: "Hello, {name}!",
        fr: "Bonjour, {name}!",
      },
    },
  });
});

export const errorFeature = defineFeature("errors", (r) => {
  r.translations({
    keys: {
      "errors.not_found": {
        de: "Nicht gefunden",
        en: "Not found",
      },
      "errors.access_denied": {
        de: "Zugriff verweigert",
        en: "Access denied",
      },
    },
  });
});
