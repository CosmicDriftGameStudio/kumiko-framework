// Gallery-Feature (server). Eine custom-Screen, die die Foundations
// (Colors/Typography/Radius/Elevation/Spacing) + atomare Components
// (Buttons, Cards) zeigt — das was die Entity-Auto-Screens nicht abdecken.
// React-Component client-seitig via clientFeatures.components zugeordnet.
//
// Eigener FeatureName (nicht "styleguide") — zwei defineFeature mit gleichem
// Namen würden in createRegistry werfen.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

type LocalizedString = { readonly de: string; readonly en: string };

// Server-Pendant zu den Nav-Labels — Boot-Validator braucht screen:gallery.title
// serverseitig registriert, auch wenn die custom-Screen selbst keinen
// gerenderten Titel aus i18n zieht.
const GALLERY_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:gallery.title": { de: "Foundations & Components", en: "Foundations & Components" },
};

export const galleryFeature = defineFeature("gallery", (r) => {
  r.translations({ keys: GALLERY_I18N });

  r.screen({ id: "gallery", type: "custom", renderer: { react: { __component: "gallery" } } });

  r.nav({ id: "styleguide", label: "Styleguide", order: 20 });
  r.nav({
    id: "gallery",
    label: "Foundations & Components",
    parent: "gallery:nav:styleguide",
    screen: "gallery:screen:gallery",
    icon: "sparkles",
    order: 10,
  });
});
