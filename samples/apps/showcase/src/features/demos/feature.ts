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

// r.translations() wants key-first shape — same screen titles already in
// ./i18n's client (locale-first) bundle.
const REQUIRED_I18N = {
  "screen:demo-layout.title": { de: "Layout", en: "Layout" },
  "screen:demo-buttons.title": { de: "Buttons", en: "Buttons" },
  "screen:demo-inputs.title": { de: "Inputs", en: "Inputs" },
  "screen:demo-banner.title": { de: "Banner", en: "Banner" },
  "screen:demo-dialog.title": { de: "Dialog & Lightbox", en: "Dialog & Lightbox" },
  "screen:demo-toast.title": { de: "Toast", en: "Toast" },
  "screen:demo-text.title": { de: "Text", en: "Text" },
  "screen:demo-sidebar-panel.title": { de: "Sidebar-Panel", en: "Sidebar panel" },
} as const;

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
  r.screen({
    id: "demo-sidebar-panel",
    type: "custom",
    renderer: { react: { __component: "demo-sidebar-panel" } },
  });

  // Section "Primitives" — clickbar-collapsible weil parent ohne screen.
  //
  // Jeder Eintrag traegt ein Icon: auf Icon-Breite ist es das Einzige, was
  // von ihm uebrig bleibt. Ohne Icon steht dort nur ein Punkt, und eine Rail
  // aus gleichen Punkten sagt nicht, wo man hinklickt.
  r.nav({ id: "primitives", label: "Primitives", order: 10 });
  r.nav({
    id: "demo-layout",
    label: "Layout",
    icon: "layout-grid",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-layout",
    order: 5,
  });
  r.nav({
    id: "demo-buttons",
    label: "Buttons",
    icon: "wand",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-buttons",
    order: 10,
  });
  r.nav({
    id: "demo-inputs",
    label: "Inputs",
    icon: "list",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-inputs",
    order: 20,
  });
  r.nav({
    id: "demo-banner",
    label: "Banner",
    icon: "bell",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-banner",
    order: 30,
  });
  r.nav({
    id: "demo-dialog",
    label: "Dialog & Lightbox",
    icon: "layers",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-dialog",
    order: 35,
  });
  r.nav({
    id: "demo-toast",
    label: "Toast",
    icon: "sparkles",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-toast",
    order: 38,
  });
  r.nav({
    id: "demo-text",
    label: "Text",
    icon: "file",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-text",
    order: 40,
  });
  r.nav({
    id: "demo-sidebar-panel",
    label: "Sidebar-Panel",
    icon: "mail",
    parent: "showcase-demos:nav:primitives",
    screen: "showcase-demos:screen:demo-sidebar-panel",
    order: 42,
  });
});
