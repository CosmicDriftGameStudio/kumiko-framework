import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeDeBundle } from "./strings";

export { localeDeBundle };

export function localeDe() {
  registerMailTranslations("de", localeDeBundle);
  return defineFeature("locale-de", (r) => {
    r.translations({
      keys: Object.fromEntries(Object.entries(localeDeBundle).map(([k, v]) => [k, { de: v }])),
    });
  });
}
