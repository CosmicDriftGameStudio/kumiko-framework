// Cross-Feature-Demo: demo-driver registriert eine Nav die sich
// selber zur driver-Workspace von `demo` zuweist. Beweist dass
// r.nav.workspaces QNs über Feature-Grenzen hinweg auflöst — nützlich
// für Teams die pro Persona ein eigenes Package haben und die an einen
// gemeinsamen Core anflanschen.

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { driverTranslations } from "./i18n";

// r.translations() wants key-first shape ({key: {de, en}}); driverTranslations
// is locale-first (client TranslationsByLocale shape) — invert here (bracket
// notation + `?? ""` fallback, see demo/feature.ts / PR#1172 for the pattern).
const REQUIRED_I18N: Record<string, { de: string; en: string }> = Object.fromEntries(
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
    workspaces: ["demo:workspace:driver"],
  });
});
