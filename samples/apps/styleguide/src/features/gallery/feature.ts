// Gallery-Feature (server). Eine custom-Screen, die die Foundations
// (Colors/Typography/Radius/Elevation/Spacing) + atomare Components
// (Buttons, Cards) zeigt — das was die Entity-Auto-Screens nicht abdecken.
// React-Component client-seitig via clientFeatures.components zugeordnet.
//
// Eigener FeatureName (nicht "styleguide") — zwei defineFeature mit gleichem
// Namen würden in createRegistry werfen.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const galleryFeature = defineFeature("gallery", (r) => {
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
