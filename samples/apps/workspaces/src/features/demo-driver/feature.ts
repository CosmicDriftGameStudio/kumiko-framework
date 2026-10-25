// Cross-feature demo: demo-driver registers a nav that assigns
// itself to the driver workspace of `demo`. Proves that
// r.nav.workspaces resolves QNs across feature boundaries — useful
// for teams that have their own package per persona and dock onto a
// shared core.

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { TranslationValue } from "@cosmicdrift/kumiko-framework/ui-types";
import { driverTranslations } from "./i18n";

// r.translations() wants key-first shape ({key: {de, en}}); driverTranslations
// is locale-first (client TranslationsByLocale shape) — invert here (bracket
// notation + `?? ""` fallback, see demo/feature.ts / PR#1172 for the pattern).
const REQUIRED_I18N: Record<string, { de: TranslationValue; en: TranslationValue }> =
  Object.fromEntries(
    Object.keys(driverTranslations["de"] ?? {}).map((key) => [
      key,
      { de: driverTranslations["de"]?.[key] ?? "", en: driverTranslations["en"]?.[key] ?? "" },
    ]),
  );

export const driverFeature: FeatureDefinition = defineFeature("demo-driver", (r) => {
  r.translations({ keys: REQUIRED_I18N });

  r.nav({
    id: "my-tour",
    label: "demo-driver:nav.myTour",
    icon: "table",
    workspaces: ["demo:workspace:driver"],
  });
});
