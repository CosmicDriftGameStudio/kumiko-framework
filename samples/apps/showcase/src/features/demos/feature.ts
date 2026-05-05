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

export const demosFeature = defineFeature("showcase-demos", (r) => {
  r.screen({ id: "demo-layout", type: "custom", renderer: {} });
  r.screen({ id: "demo-buttons", type: "custom", renderer: {} });
  r.screen({ id: "demo-inputs", type: "custom", renderer: {} });
  r.screen({ id: "demo-banner", type: "custom", renderer: {} });
  r.screen({ id: "demo-dialog", type: "custom", renderer: {} });
  r.screen({ id: "demo-toast", type: "custom", renderer: {} });
  r.screen({ id: "demo-text", type: "custom", renderer: {} });

  // Section "Primitives" — clickbar-collapsible weil parent ohne screen.
  r.nav({ id: "primitives", label: "Primitives", order: 10 });
  r.nav({
    id: "demo-layout",
    label: "Layout",
    parent: "primitives",
    screen: "demo-layout",
    order: 5,
  });
  r.nav({
    id: "demo-buttons",
    label: "Buttons",
    parent: "primitives",
    screen: "demo-buttons",
    order: 10,
  });
  r.nav({
    id: "demo-inputs",
    label: "Inputs",
    parent: "primitives",
    screen: "demo-inputs",
    order: 20,
  });
  r.nav({
    id: "demo-banner",
    label: "Banner",
    parent: "primitives",
    screen: "demo-banner",
    order: 30,
  });
  r.nav({
    id: "demo-dialog",
    label: "Dialog",
    parent: "primitives",
    screen: "demo-dialog",
    order: 35,
  });
  r.nav({
    id: "demo-toast",
    label: "Toast",
    parent: "primitives",
    screen: "demo-toast",
    order: 38,
  });
  r.nav({
    id: "demo-text",
    label: "Text",
    parent: "primitives",
    screen: "demo-text",
    order: 40,
  });
});
