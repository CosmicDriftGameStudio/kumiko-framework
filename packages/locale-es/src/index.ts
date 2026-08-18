import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeEsBundle } from "./strings";

export { localeEsBundle };

export function localeEs() {
  registerMailTranslations("es", localeEsBundle);
  return defineFeature("locale-es", (r) => {
    r.translations({
      keys: Object.fromEntries(Object.entries(localeEsBundle).map(([k, v]) => [k, { es: v }])),
    });
  });
}
