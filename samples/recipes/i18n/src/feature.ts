// i18n Sample
// Shows: r.translations() for multi-language feature keys, and plural forms
// (CLDR categories) for a count-dependent key

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
      "greeting.unread_count": {
        de: { one: "{count} ungelesene Nachricht", other: "{count} ungelesene Nachrichten" },
        en: { one: "{count} unread message", other: "{count} unread messages" },
        pl: {
          one: "{count} nieprzeczytana wiadomość",
          few: "{count} nieprzeczytane wiadomości",
          many: "{count} nieprzeczytanych wiadomości",
          other: "{count} nieprzeczytanej wiadomości",
        },
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
