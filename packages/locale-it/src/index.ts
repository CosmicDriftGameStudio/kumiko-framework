import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeItBundle } from "./strings";

export { localeItBundle };

export function localeIt() {
  registerMailTranslations("it", localeItBundle);
  return defineFeature("locale-it", (r) => {
    r.describe(
      "Italian UI and mail copy for framework screens. Opt-in; not included by includeBundled.",
    );
    r.translations({
      keys: Object.fromEntries(Object.entries(localeItBundle).map(([k, v]) => [k, { it: v }])),
    });
  });
}
