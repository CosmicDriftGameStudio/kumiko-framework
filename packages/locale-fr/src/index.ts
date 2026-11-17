import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { localeFrBundle } from "./strings";

export { localeFrBundle };

export function localeFr() {
  registerMailTranslations("fr", localeFrBundle);
  return defineFeature("locale-fr", (r) => {
    r.describe(
      "French UI and mail copy for framework screens. Opt-in; not included by includeBundled.",
    );
    r.translations({
      keys: Object.fromEntries(Object.entries(localeFrBundle).map(([k, v]) => [k, { fr: v }])),
    });
  });
}
