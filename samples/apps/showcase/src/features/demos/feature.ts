// Demos-Feature — Server-Side. Registriert custom-Screens für die UI-
// Demo-Pages (Buttons, Inputs, Banner, Text, Layout) und ihre Nav-
// Einträge. Kein Entity, keine Handler — pure Custom-Screen-Showcase.
//
// FeatureName "showcase-demos" (nicht "showcase"): zwei defineFeature-
// Aufrufe mit gleichem Namen würden in createRegistry mit
// `Duplicate feature` werfen. Der Trennstrich zur items-Feature ist
// also nicht Konvention-Geschmack, sondern technische Notwendigkeit.
//
// Die React-Components für die custom-Screens leben in pages/ und
// werden client-side via clientFeatures.components zugeordnet (siehe
// client.ts).

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { demosTranslations } from "./i18n";

// r.translations() wants key-first shape ({key: {de, en}}); demosTranslations
// is locale-first (client TranslationsByLocale shape) — invert here rather
// than duplicating the strings.
const REQUIRED_I18N = Object.fromEntries(
  Object.keys(demosTranslations.de).map((key) => [
    key,
    { de: demosTranslations.de[key], en: demosTranslations.en[key] },
  ]),
);

export const demosFeature = defineFeature("showcase-demos", (r) => {
  r.translations({ keys: REQUIRED_I18N });

  r.screen({
    id: "demo-layout",
    type: "custom",
    renderer: { react: { __component: "demo-layout" } },
  });
  r.screen({
    id: "demo-buttons",
    type: "custom",
    renderer: { react: { __component: "demo-buttons" } },
  });
  r.screen({
    id: "demo-inputs",
    type: "custom",
    renderer: { react: { __component: "demo-inputs" } },
  });
  r.screen({
    id: "demo-banner",
    type: "custom",
    renderer: { react: { __component: "demo-banner" } },
  });
  r.screen({
    id: "demo-dialog",
    type: "custom",
    renderer: { react: { __component: "demo-dialog" } },
  });
  r.screen({
    id: "demo-toast",
    type: "custom",
    renderer: { react: { __component: "demo-toast" } },
  });
  r.screen({ id: "demo-text", type: "custom", renderer: { react: { __component: "demo-text" } } });

  // Section "Primitives" — clickbar-collapsible weil parent ohne screen.
  r.nav({ id: "primitives", label: "Primitives", order: 10 });
  r.nav({
    id: "demo-layout",
    label: "Layout",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-layout",
    order: 5,
  });
  r.nav({
    id: "demo-buttons",
    label: "Buttons",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-buttons",
    order: 10,
  });
  r.nav({
    id: "demo-inputs",
    label: "Inputs",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-inputs",
    order: 20,
  });
  r.nav({
    id: "demo-banner",
    label: "Banner",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-banner",
    order: 30,
  });
  r.nav({
    id: "demo-dialog",
    label: "Dialog & Lightbox",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-dialog",
    order: 35,
  });
  r.nav({
    id: "demo-toast",
    label: "Toast",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-toast",
    order: 38,
  });
  r.nav({
    id: "demo-text",
    label: "Text",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-text",
    order: 40,
  });
});
