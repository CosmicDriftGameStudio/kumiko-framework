import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { type GermanAddress, germanBundleFor } from "./formal";
import { localeDeBundle } from "./strings";

export type { GermanAddress };
export { localeDeBundle };

export function localeDe(options?: { readonly address?: GermanAddress }) {
  const bundle = germanBundleFor(options?.address ?? "informal");
  registerMailTranslations("de", bundle);
  return defineFeature("locale-de", (r) => {
    r.describe(
      "German UI and mail copy for framework screens. Opt-in; not included by includeBundled.",
    );
    r.translations({
      keys: Object.fromEntries(Object.entries(bundle).map(([k, v]) => [k, { de: v }])),
    });
  });
}
